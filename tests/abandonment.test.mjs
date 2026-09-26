import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createTarokServer } from '../server/index.mjs';
import { hash } from '../server/identity.mjs';

const secret = () => randomBytes(32).toString('base64url');

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-abandonment-'));
  const clients = [];
  let server, address;
  const start = async () => {
    server = await createTarokServer({ dataDir, logger: { warn() {}, error() {} } });
    address = await server.listen(0, '127.0.0.1');
  };
  const stop = async () => {
    clients.forEach(client => client.socket.disconnect());
    if (server) await server.close();
    server = null;
  };
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  const connect = async (name, credential = secret()) => {
    const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false });
    const client = {
      socket, credential, state: null, states: [], abandoned: [], tableUpdates: [],
      call: (event, payload = {}) => socket.timeout(3000).emitWithAck(event, payload),
    };
    socket.on('state', state => { client.state = state; client.states.push(state); });
    socket.on('room:abandoned', event => client.abandoned.push(event));
    socket.on('tables', tables => client.tableUpdates.push(tables));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    clients.push(client);
    if (name) {
      const result = await client.call('identity:create', { name, credential });
      assert.equal(result.ok, true);
      client.user = result.user;
    }
    return client;
  };
  const link = async owner => {
    const invitation = await owner.call('devices:link');
    const client = await connect();
    const result = await client.call('identity:redeem', { kind: 'device', token: invitation.token, credential: client.credential });
    assert.equal(result.ok, true);
    client.user = result.user;
    return client;
  };
  const saved = roomId => readFile(path.join(dataDir, `${roomId}.json`), 'utf8');
  return { dataDir, connect, link, start, stop, saved };
}

async function listedTable(client, roomId) {
  return (await client.call('tables:list')).tables.find(table => table.roomId === roomId);
}

function assertPending(table, roomId) {
  assert.equal(table.roomId, roomId);
  assert.equal(table.status, 'abandoned');
  assert.equal(table.disposition, 'pending');
  assert.ok(Number.isFinite(Date.parse(table.abandonedAt)));
}

test('abandoning a waiting table from home requires ownership and updates linked devices', async t => {
  const f = await fixture(t);
  const a = await f.connect('Ana'), stranger = await f.connect('Tujec'), anonymous = await f.connect();
  const first = await a.call('room:create'), keep = await a.call('room:create');
  await a.call('room:leave');
  const linked = await f.link(a);
  const before = JSON.parse(await f.saved(first.roomId));

  assert.equal((await anonymous.call('room:abandon', { roomId: first.roomId })).code, 'AUTH_REQUIRED');
  assert.equal((await stranger.call('room:abandon', { roomId: first.roomId, invitation: first.invitation })).ok, false);
  assert.deepEqual(JSON.parse(await f.saved(first.roomId)), before);

  const abandoned = await a.call('room:abandon', { roomId: first.roomId });
  assert.equal(abandoned.ok, true);
  assert.equal(abandoned.roomId, first.roomId);
  assertPending(abandoned.tables.find(table => table.roomId === first.roomId), first.roomId);
  for (const client of [a, linked]) {
    assertPending(await listedTable(client, first.roomId), first.roomId);
    assert.equal((await listedTable(client, keep.roomId)).status, 'waiting');
    assert.deepEqual(client.abandoned, [{ roomId: first.roomId }]);
  }
  await stranger.call('tables:list');
  assert.deepEqual(stranger.abandoned, []);
  assert.deepEqual(anonymous.abandoned, []);
  const closed = JSON.parse(await f.saved(first.roomId));
  assert.ok(Number.isFinite(Date.parse(closed.abandonedAt)));
  assert.equal(closed.abandonedBy, first.playerId);
  assert.equal(closed.revision, before.revision + 1);
  assert.deepEqual(closed.players, before.players);
  assert.equal(closed.game, before.game);
  assert.equal(closed.invitationHash, undefined);
  assert.equal((await stranger.call('room:join', { roomId: first.roomId, invitation: first.invitation })).code, 'INVALID_INVITE');
  assert.equal((await a.call('room:invite', { roomId: first.roomId })).code, 'ROOM_ABANDONED');
  assert.equal((await a.call('room:join', { roomId: first.roomId })).code, 'ROOM_ABANDONED');
  assert.equal((await a.call('room:resume', { roomId: keep.roomId })).ok, true);
});

test('abandonment closes active play for both players, is idempotent, and survives restart with saved game intact', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Luka');
  const room = await a.call('room:create');
  assert.equal((await b.call('room:join', { roomId: room.roomId, invitation: room.invitation })).ok, true);
  const linked = await f.link(a);
  await linked.call('room:resume', { roomId: room.roomId });
  await a.call('room:leave');
  // Flush earlier presence updates before counting state emissions from closure.
  await Promise.all([b, linked].map(client => client.call('tables:list')));
  const stateCounts = [b.states.length, linked.states.length];
  const before = JSON.parse(await f.saved(room.roomId));

  assert.equal((await a.call('room:abandon', { roomId: room.roomId })).ok, true);
  for (const [index, client] of [b, linked].entries()) {
    assertPending(await listedTable(client, room.roomId), room.roomId);
    assert.deepEqual(client.abandoned, [{ roomId: room.roomId }]);
    assert.equal(client.states.length, stateCounts[index], 'Closure must not emit another playable state');
    assert.equal((await client.call('game:action', { type: 'bid', bid: 'pass', expectedRevision: before.revision })).ok, false);
    const resume = await client.call('room:resume', { roomId: room.roomId });
    assert.equal(resume.code, 'ROOM_ABANDONED');
    assert.equal(resume.error, 'Ta miza je opuščena.');
  }
  const savedOnce = await f.saved(room.roomId);
  const closed = JSON.parse(savedOnce);
  assert.deepEqual(closed.game, before.game);
  assert.deepEqual(closed.players, before.players);
  assert.equal((await b.call('room:abandon', { roomId: room.roomId })).ok, true);
  assert.equal(await f.saved(room.roomId), savedOnce, 'Retries must retain the original abandonment record');
  for (const client of [a, b, linked]) {
    await client.call('tables:list');
    assert.deepEqual(client.abandoned, [{ roomId: room.roomId }], 'Retries do not repeat the closure notification');
  }

  await f.stop(); await f.start();
  for (const credential of [a.credential, b.credential, linked.credential]) {
    const restored = await f.connect();
    const identity = await restored.call('identity:resume', { credential });
    assert.equal(identity.ok, true);
    assertPending(identity.tables[0], room.roomId);
    assert.equal((await restored.call('room:resume', { roomId: room.roomId })).code, 'ROOM_ABANDONED');
    assert.equal((await restored.call('room:join', { roomId: room.roomId })).code, 'ROOM_ABANDONED');
    assert.equal((await restored.call('room:abandon', { roomId: room.roomId })).ok, true);
  }
  assert.equal(await f.saved(room.roomId), savedOnce);
});

test('failed abandonment persistence keeps the table, invitation, and connections usable', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Luka');
  const room = await a.call('room:create');
  const original = await f.saved(room.roomId);
  const file = path.join(f.dataDir, `${room.roomId}.json`);
  await rename(file, `${file}.saved`);
  await mkdir(file);

  assert.equal((await a.call('room:abandon', { roomId: room.roomId })).ok, false);
  assert.deepEqual((await a.call('tables:list')).tables.map(table => table.roomId), [room.roomId]);
  assert.deepEqual(a.abandoned, []);
  assert.equal((await a.call('room:resume', { roomId: room.roomId })).ok, true);
  assert.equal(await readFile(`${file}.saved`, 'utf8'), original);

  await rm(file, { recursive: true });
  await rename(`${file}.saved`, file);
  assert.equal((await b.call('room:join', { roomId: room.roomId, invitation: room.invitation })).ok, true);
  assert.equal((await a.call('room:abandon', { roomId: room.roomId })).ok, true);
  assertPending(await listedTable(b, room.roomId), room.roomId);
});

test('abandonment serializes with joins and game actions so pending work cannot reopen a closed table', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Luka');
  const waiting = await a.call('room:create');
  const [abandon, join] = await Promise.all([
    a.call('room:abandon', { roomId: waiting.roomId }),
    b.call('room:join', { roomId: waiting.roomId, invitation: waiting.invitation }),
  ]);
  assert.equal(abandon.ok, true);
  assert.ok(join.ok || join.code === 'INVALID_INVITE');
  assert.ok(JSON.parse(await f.saved(waiting.roomId)).abandonedAt);
  assertPending(await listedTable(a, waiting.roomId), waiting.roomId);
  if (join.ok) assertPending(await listedTable(b, waiting.roomId), waiting.roomId);
  else assert.deepEqual((await b.call('tables:list')).tables, []);

  const active = await a.call('room:create');
  await b.call('room:join', { roomId: active.roomId, invitation: active.invitation });
  await a.call('room:resume', { roomId: active.roomId });
  const bidder = a.state.game.legalBids.length ? a : b;
  const before = JSON.parse(await f.saved(active.roomId));
  // Packets on the same socket dispatch in order; the action waits behind the
  // asynchronous abandonment write in the room's operation queue.
  const [closed, action] = await Promise.all([
    bidder.call('room:abandon', { roomId: active.roomId }),
    bidder.call('game:action', { type: 'bid', bid: 'pass', expectedRevision: before.revision }),
  ]);
  assert.equal(closed.ok, true);
  assert.equal(action.code, 'ROOM_ABANDONED');
  assert.deepEqual(JSON.parse(await f.saved(active.roomId)).game, before.game);
});

test('claimed legacy seats can abandon tables and neither old token can restore them', async t => {
  const f = await fixture(t);
  const tokenA = secret(), tokenB = secret();
  await f.stop();
  await writeFile(path.join(f.dataDir, 'ABC234.json'), JSON.stringify({
    version: 1, id: 'ABC234', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    players: [{ id: 'seat-a', name: 'Ana', tokenHash: hash(tokenA) }, { id: 'seat-b', name: 'Luka', tokenHash: hash(tokenB) }], game: null,
  }));
  await f.start();
  const a = await f.connect('Ana'), b = await f.connect('Luka'), stranger = await f.connect('Tujec');
  assert.equal((await a.call('identity:claim', { roomId: 'ABC234', token: tokenA })).ok, true);
  assert.equal((await b.call('identity:claim', { roomId: 'ABC234', token: tokenB })).ok, true);
  assert.equal((await a.call('room:abandon', { roomId: 'ABC234' })).ok, true);
  for (const [client, token] of [[a, tokenA], [b, tokenB], [stranger, tokenA]]) {
    assert.equal((await client.call('identity:legacy', { roomId: 'ABC234', token })).code, 'ROOM_ABANDONED');
    assert.equal((await client.call('identity:claim', { roomId: 'ABC234', token })).code, 'ROOM_ABANDONED');
  }
  assertPending(await listedTable(b, 'ABC234'), 'ABC234');
  const closed = JSON.parse(await f.saved('ABC234'));
  assert.equal(closed.abandonedBy, 'seat-a');
  assert.equal(closed.players[0].tokenHash, hash(tokenA));
  assert.equal(closed.players[1].tokenHash, hash(tokenB));
  await f.stop(); await f.start();
  const restored = await f.connect();
  assertPending((await restored.call('identity:resume', { credential: b.credential })).tables[0], 'ABC234');
  assert.equal((await restored.call('identity:claim', { roomId: 'ABC234', token: tokenB })).code, 'ROOM_ABANDONED');
  assert.equal((await restored.call('room:abandon', { roomId: 'ABC234' })).ok, true);
});

test('revoked devices cannot abandon their former tables', async t => {
  const f = await fixture(t), a = await f.connect('Ana');
  const room = await a.call('room:create'), linked = await f.link(a);
  const devices = await a.call('devices:list');
  assert.equal((await a.call('devices:revoke', { id: devices.devices.find(device => !device.current).id })).ok, true);
  const revoked = await f.connect();
  assert.equal((await revoked.call('identity:resume', { credential: linked.credential })).code, 'AUTH_REQUIRED');
  assert.equal((await revoked.call('room:abandon', { roomId: room.roomId })).code, 'AUTH_REQUIRED');
  assert.deepEqual((await a.call('tables:list')).tables.map(table => table.roomId), [room.roomId]);
  assert.equal(JSON.parse(await f.saved(room.roomId)).abandonedAt, undefined);
});

for (const [choiceA, choiceB] of [['archived', 'deleted'], ['archived', 'archived'], ['deleted', 'deleted']]) {
  test(`each player independently keeps their abandoned table ${choiceA}/${choiceB}`, async t => {
    const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Luka');
    const room = await a.call('room:create');
    const joined = await b.call('room:join', { roomId: room.roomId, invitation: room.invitation });
    await a.call('room:abandon', { roomId: room.roomId });
    const beforeB = await listedTable(b, room.roomId);
    const closed = JSON.parse(await f.saved(room.roomId));

    const resultA = await a.call('room:disposition', { roomId: room.roomId, disposition: choiceA });
    assert.equal(resultA.ok, true);
    assert.deepEqual(await listedTable(b, room.roomId), beforeB, 'One player choosing cannot alter the other player’s listing');
    assert.deepEqual(b.tableUpdates.at(-1), [beforeB], 'Broadcasts reveal only the recipient’s choice');
    const resultB = await b.call('room:disposition', { roomId: room.roomId, disposition: choiceB });
    assert.equal(resultB.ok, true);
    for (const [client, choice, result] of [[a, choiceA, resultA], [b, choiceB, resultB]]) {
      const table = await listedTable(client, room.roomId);
      assert.deepEqual(result.tables, (await client.call('tables:list')).tables);
      if (choice === 'deleted') assert.equal(table, undefined);
      else {
        assert.equal(table.disposition, 'archived');
        assert.equal(table.status, 'abandoned');
        assert.deepEqual(Object.keys(table).sort(), ['abandonedAt', 'disposition', 'opponent', 'roomId', 'status', 'updatedAt']);
      }
      assert.equal((await client.call('room:resume', { roomId: room.roomId })).code, 'ROOM_ABANDONED');
    }
    const saved = JSON.parse(await f.saved(room.roomId));
    assert.deepEqual(saved.dispositions, { [room.playerId]: choiceA, [joined.playerId]: choiceB });
    assert.deepEqual(saved.game, closed.game);
    assert.deepEqual(saved.players, closed.players);
    assert.equal(saved.updatedAt, closed.updatedAt);
    assert.equal(saved.revision, closed.revision);

    await f.stop(); await f.start();
    for (const [credential, choice] of [[a.credential, choiceA], [b.credential, choiceB]]) {
      const restored = await f.connect();
      const identity = await restored.call('identity:resume', { credential });
      if (choice === 'deleted') assert.deepEqual(identity.tables, []);
      else assert.equal(identity.tables[0].disposition, 'archived');
    }
    assert.deepEqual(JSON.parse(await f.saved(room.roomId)), saved, 'Restart retains the complete record, including two deleted listings');
  });
}

test('offline players choose on return and linked devices share only their owner’s choice', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Luka');
  const room = await a.call('room:create');
  await b.call('room:join', { roomId: room.roomId, invitation: room.invitation });
  b.socket.disconnect();
  await a.call('room:abandon', { roomId: room.roomId });
  await a.call('room:disposition', { roomId: room.roomId, disposition: 'archived' });
  await f.stop(); await f.start();

  const returning = await f.connect();
  assertPending((await returning.call('identity:resume', { credential: b.credential })).tables[0], room.roomId);
  const linked = await f.link(returning);
  assertPending(await listedTable(linked, room.roomId), room.roomId);
  assert.equal((await linked.call('room:disposition', { roomId: room.roomId, disposition: 'deleted' })).ok, true);
  assert.deepEqual((await returning.call('tables:list')).tables, []);
  assert.deepEqual(returning.tableUpdates.at(-1), []);
  assert.deepEqual(linked.tableUpdates.at(-1), []);
  const archived = await f.connect();
  assert.equal((await archived.call('identity:resume', { credential: a.credential })).tables[0].disposition, 'archived');
});

test('disposition requests require the owner, valid choice, and an abandoned table', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), stranger = await f.connect('Tujec'), anonymous = await f.connect();
  const room = await a.call('room:create'), original = await f.saved(room.roomId);
  for (const disposition of ['archived', 'deleted']) {
    assert.equal((await a.call('room:disposition', { roomId: room.roomId, disposition })).code, 'ROOM_ACTIVE');
    assert.equal((await anonymous.call('room:disposition', { roomId: room.roomId, disposition })).code, 'AUTH_REQUIRED');
    assert.equal((await stranger.call('room:disposition', { roomId: room.roomId, disposition, playerId: room.playerId, invitation: room.invitation })).ok, false);
  }
  assert.equal(await f.saved(room.roomId), original);
  await a.call('room:abandon', { roomId: room.roomId });
  const closed = await f.saved(room.roomId);
  for (const disposition of [undefined, null, 'pending', 'archive', '', {}, ['archived']]) {
    assert.equal((await a.call('room:disposition', { roomId: room.roomId, disposition })).code, 'INVALID_DISPOSITION');
  }
  assert.equal((await stranger.call('room:disposition', { roomId: room.roomId, disposition: 'deleted', playerId: room.playerId })).ok, false);
  assert.equal(await f.saved(room.roomId), closed);
  assertPending(await listedTable(a, room.roomId), room.roomId);
  const linked = await f.link(a);
  const devices = await a.call('devices:list');
  await a.call('devices:revoke', { id: devices.devices.find(device => !device.current).id });
  const revoked = await f.connect();
  assert.equal((await revoked.call('identity:resume', { credential: linked.credential })).code, 'AUTH_REQUIRED');
  assert.equal((await revoked.call('room:disposition', { roomId: room.roomId, disposition: 'deleted' })).code, 'AUTH_REQUIRED');
  assert.equal(await f.saved(room.roomId), closed);
});

test('failed choice persistence keeps pending or archived status and does not broadcast a change', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), linked = await f.link(a);
  const room = await a.call('room:create');
  await a.call('room:abandon', { roomId: room.roomId });
  const file = path.join(f.dataDir, `${room.roomId}.json`);
  for (const [choice, expected] of [['archived', 'pending'], ['deleted', 'archived']]) {
    const before = await listedTable(a, room.roomId), original = await f.saved(room.roomId);
    await linked.call('tables:list');
    const updateCounts = [a.tableUpdates.length, linked.tableUpdates.length];
    await rename(file, `${file}.saved`);
    await mkdir(file);
    const failed = await a.call('room:disposition', { roomId: room.roomId, disposition: choice });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, 'Zahteve ni bilo mogoče shraniti. Poskusi znova.');
    for (const [index, client] of [a, linked].entries()) {
      assert.deepEqual(await listedTable(client, room.roomId), before);
      assert.equal(client.tableUpdates.length, updateCounts[index]);
    }
    assert.equal(before.disposition, expected);
    assert.equal(await readFile(`${file}.saved`, 'utf8'), original);
    await rm(file, { recursive: true });
    await rename(`${file}.saved`, file);
    assert.equal((await a.call('room:disposition', { roomId: room.roomId, disposition: choice })).ok, true);
  }
  assert.equal(await listedTable(linked, room.roomId), undefined);
});

test('concurrent choices preserve both seats and deleted tables cannot be restored by stale devices or retries', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Luka'), linked = await f.link(a);
  const room = await a.call('room:create');
  const joined = await b.call('room:join', { roomId: room.roomId, invitation: room.invitation });
  await a.call('room:abandon', { roomId: room.roomId });
  const results = await Promise.all([
    a.call('room:disposition', { roomId: room.roomId, disposition: 'archived' }),
    b.call('room:disposition', { roomId: room.roomId, disposition: 'deleted' }),
  ]);
  assert.ok(results.every(result => result.ok));
  assert.deepEqual(JSON.parse(await f.saved(room.roomId)).dispositions, { [room.playerId]: 'archived', [joined.playerId]: 'deleted' });
  const choices = await Promise.all([
    linked.call('room:disposition', { roomId: room.roomId, disposition: 'deleted' }),
    a.call('room:disposition', { roomId: room.roomId, disposition: 'archived' }),
  ]);
  assert.ok(choices.every(result => result.ok));
  const deleted = await f.saved(room.roomId);
  for (const client of [a, b, linked]) {
    for (const disposition of ['archived', 'deleted']) {
      const retry = await client.call('room:disposition', { roomId: room.roomId, disposition });
      assert.equal(retry.ok, true);
      assert.deepEqual(retry.tables, []);
    }
    assert.equal((await client.call('room:abandon', { roomId: room.roomId })).ok, true);
    assert.deepEqual(client.abandoned, [{ roomId: room.roomId }]);
    assert.equal(await listedTable(client, room.roomId), undefined);
  }
  assert.equal(await f.saved(room.roomId), deleted, 'Idempotent requests never rewrite or restore deleted listings');
});
