import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createTarokServer } from '../server/index.mjs';
import { hash, openIdentities } from '../server/identity.mjs';
import { createGame } from '../shared/game.mjs';

const secret = () => randomBytes(32).toString('base64url');

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-name-change-'));
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
      socket, credential, state: null, updates: [], tableUpdates: [],
      call: (event, payload = {}) => socket.timeout(3000).emitWithAck(event, payload),
    };
    socket.on('state', state => { client.state = state; });
    socket.on('identity:updated', update => client.updates.push(update));
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

function withoutNames(state) {
  const copy = structuredClone(state);
  for (const player of copy.players) delete player.name;
  for (const player of copy.game?.players || []) delete player.name;
  return copy;
}

test('renaming updates linked devices and opponents in active, waiting and archived tables without changing games', async t => {
  const f = await fixture(t);
  const a = await f.connect('Ana'), b = await f.connect('Bor'), outsider = await f.connect('Cene');
  const game = await a.call('room:create');
  await b.call('room:join', { roomId: game.roomId, invitation: game.invitation });
  const archive = await a.call('room:create');
  await b.call('room:join', { roomId: archive.roomId, invitation: archive.invitation });
  await a.call('room:abandon', { roomId: archive.roomId });
  await b.call('room:disposition', { roomId: archive.roomId, disposition: 'archived' });
  const waiting = await a.call('room:create');
  await a.call('room:resume', { roomId: game.roomId });
  await b.call('room:resume', { roomId: game.roomId });
  const linked = await f.link(a);
  await linked.call('room:resume', { roomId: game.roomId });
  // Round-trip on each socket also drains earlier presence events.
  await Promise.all([a, b, linked, outsider].map(client => client.call('tables:list')));
  const before = new Map(await Promise.all([game, archive, waiting].map(async room => [room.roomId, await f.saved(room.roomId)])));
  const states = [a, b, linked].map(client => structuredClone(client.state));
  const previousTables = (await b.call('tables:list')).tables;

  const result = await linked.call('identity:rename', { name: '  Ana   Nova  ' });
  assert.deepEqual(result, { ok: true, user: { id: a.user.id, name: 'Ana Nova' } });
  await Promise.all([a, b, linked, outsider].map(client => client.call('tables:list')));
  for (const client of [a, linked]) assert.deepEqual(client.updates, [{ user: result.user }]);
  assert.deepEqual(b.updates, []);
  assert.deepEqual(outsider.updates, []);
  for (const [index, client] of [a, b, linked].entries()) {
    assert.equal(client.state.players.find(player => player.id === game.playerId).name, 'Ana Nova');
    assert.equal(client.state.game.players.find(player => player.id === game.playerId).name, 'Ana Nova');
    assert.deepEqual(withoutNames(client.state), withoutNames(states[index]));
  }
  assert.deepEqual(b.tableUpdates.at(-1), previousTables.map(table => ({ ...table, opponent: 'Ana Nova' })));
  for (const [roomId, record] of before) assert.equal(await f.saved(roomId), record, 'rename never rewrites saved games');

  await a.call('room:resume', { roomId: waiting.roomId });
  assert.equal(a.state.players[0].name, 'Ana Nova');
  assert.equal(a.state.game, null);
  const future = await a.call('room:create');
  assert.equal(JSON.parse(await f.saved(future.roomId)).players[0].name, 'Ana Nova');
  // The pre-rename revision still authorizes the next move.
  const bidder = states[0].game.legalBids.length ? linked : b;
  assert.equal((await bidder.call('game:action', { type: 'bid', bid: 'pass', expectedRevision: states[0].revision })).ok, true);

  await f.stop();
  await f.start();
  const restored = await f.connect(), opponent = await f.connect();
  assert.deepEqual((await restored.call('identity:resume', { credential: a.credential })).user, result.user);
  const opponentSession = await opponent.call('identity:resume', { credential: b.credential });
  assert.ok(opponentSession.tables.every(table => table.opponent === 'Ana Nova'));
  assert.equal(opponentSession.tables.find(table => table.roomId === archive.roomId).disposition, 'archived');
  await restored.call('room:resume', { roomId: game.roomId });
  assert.equal(restored.state.players[0].name, 'Ana Nova');
  assert.equal(restored.state.game.players[0].name, 'Ana Nova');
  assert.equal(restored.state.revision, states[0].revision + 1);
  await restored.call('room:resume', { roomId: waiting.roomId });
  assert.equal(restored.state.players[0].name, 'Ana Nova');
  assert.equal(await f.saved(waiting.roomId), before.get(waiting.roomId));
});

test('renaming requires current authentication and validates the existing Unicode name limits', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), anonymous = await f.connect();
  const file = path.join(f.dataDir, 'identities.json');
  const original = await readFile(file, 'utf8');
  assert.equal((await anonymous.call('identity:rename', { name: 'Forged', credential: a.credential, userId: a.user.id })).code, 'AUTH_REQUIRED');
  for (const name of [null, 1, [], '', '   ', 'A'.repeat(25), 'Bad\u0000name', 'Bad\u200bname']) {
    assert.equal((await a.call('identity:rename', { name })).ok, false);
  }
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(a.updates, []);
  const name = '🂡'.repeat(24);
  assert.deepEqual((await a.call('identity:rename', { name })).user, { id: a.user.id, name });
  const linked = await f.link(a);
  const devices = await a.call('devices:list');
  await a.call('devices:revoke', { id: devices.devices.find(device => !device.current).id });
  const revoked = await f.connect();
  assert.equal((await revoked.call('identity:resume', { credential: linked.credential })).code, 'AUTH_REQUIRED');
  assert.equal((await revoked.call('identity:rename', { name: 'Revoked', credential: linked.credential })).code, 'AUTH_REQUIRED');
  assert.equal((await a.call('identity:resume', { credential: a.credential })).user.name, name);
});

test('a failed name write publishes nothing and can be retried after storage recovers', async t => {
  const f = await fixture(t), a = await f.connect('Ana'), b = await f.connect('Bor');
  const room = await a.call('room:create');
  await b.call('room:join', { roomId: room.roomId, invitation: room.invitation });
  await a.call('room:resume', { roomId: room.roomId });
  const linked = await f.link(a);
  const file = path.join(f.dataDir, 'identities.json');
  const before = await readFile(file, 'utf8');
  const gameBefore = await f.saved(room.roomId);
  const tablesBefore = b.tableUpdates.length;
  const stateBefore = structuredClone(a.state);
  await rename(file, `${file}.saved`);
  await mkdir(file);
  assert.deepEqual(await a.call('identity:rename', { name: 'Ana Nova' }), { ok: false, error: 'Zahteve ni bilo mogoče shraniti. Poskusi znova.' });
  assert.equal((await linked.call('identity:resume', { credential: linked.credential })).user.name, 'Ana');
  await b.call('tables:list');
  assert.deepEqual(a.updates, []);
  assert.deepEqual(linked.updates, []);
  assert.equal(b.tableUpdates.length, tablesBefore);
  assert.deepEqual(a.state, stateBefore);
  assert.equal(await f.saved(room.roomId), gameBefore);
  assert.equal(await readFile(`${file}.saved`, 'utf8'), before);

  await rm(file, { recursive: true });
  await rename(`${file}.saved`, file);
  assert.equal((await a.call('identity:rename', { name: 'Ana Nova' })).ok, true);
  await linked.call('tables:list');
  assert.equal(linked.updates.at(-1).user.name, 'Ana Nova');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).users[a.user.id].name, 'Ana Nova');
});

test('legacy claims keep seat names until an explicit rename and project the new name after restart', async t => {
  const f = await fixture(t);
  await f.stop();
  const token = secret(), otherToken = secret();
  const players = [{ id: 'old-a', name: 'Old Ana', tokenHash: hash(token) }, { id: 'old-b', name: 'Old Bor', tokenHash: hash(otherToken) }];
  const room = { version: 1, id: 'ABC234', revision: 8, createdAt: '2026-01-01', updatedAt: '2026-01-01', players,
    game: createGame({ playerIds: players.map(player => player.id), names: players.map(player => player.name) }) };
  room.game.players[0].score = 37;
  room.game.players[1].score = -37;
  await writeFile(path.join(f.dataDir, 'ABC234.json'), JSON.stringify(room));
  await f.start();
  const a = await f.connect('Current Ana'), b = await f.connect('Current Bor');
  await a.call('identity:claim', { roomId: room.id, token });
  await b.call('identity:claim', { roomId: room.id, token: otherToken });
  await a.call('room:resume', { roomId: room.id });
  await b.call('room:resume', { roomId: room.id });
  await a.call('tables:list');
  assert.deepEqual(a.state.players.map(player => player.name), ['Old Ana', 'Old Bor']);
  const before = structuredClone(a.state);
  await a.call('identity:rename', { name: 'New Ana' });
  await b.call('tables:list');
  assert.deepEqual(a.state.players.map(player => player.name), ['New Ana', 'Old Bor']);
  assert.deepEqual(b.state.game.players.map(player => player.name), ['New Ana', 'Old Bor']);
  assert.deepEqual(withoutNames(a.state), withoutNames(before));
  assert.equal(await f.saved(room.id), JSON.stringify(room));

  await f.stop(); await f.start();
  const restored = await f.connect();
  await restored.call('identity:resume', { credential: a.credential });
  await restored.call('room:resume', { roomId: room.id });
  assert.deepEqual(restored.state.game.players.map(player => player.name), ['New Ana', 'Old Bor']);
  assert.deepEqual(restored.state.game.players.map(player => player.score), [37, -37]);
  assert.equal(restored.state.revision, 8);
});

test('concurrent name changes serialize and later revocation blocks a queued rename', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tarok-name-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const registry = await openIdentities(dir), first = secret(), second = secret(), token = secret();
  await registry.create('Ana', first);
  await registry.link(first, token);
  await registry.redeem('device', token, second);
  await Promise.all([registry.renameUser(first, 'First'), registry.renameUser(second, 'Second')]);
  assert.equal(registry.user(first).name, 'Second');
  const deviceId = registry.device(second).id;
  const outcomes = await Promise.allSettled([registry.revoke(first, deviceId), registry.renameUser(second, 'Revoked')]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[1].reason.code, 'AUTH_REQUIRED');
  assert.equal(registry.user(first).name, 'Second');
  await registry.close();
  const restored = await openIdentities(dir);
  assert.equal(restored.user(first).name, 'Second');
  assert.throws(() => restored.user(second), { code: 'AUTH_REQUIRED' });
});
