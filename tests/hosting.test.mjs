import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { io as connectSocket } from 'socket.io-client';
import { createTarokServer } from '../server/index.mjs';

const quietLogger = { warn() {}, error() {} };
const trustedLoopback = ['127.0.0.1/8', '::1/128'];

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-hosting-test-'));
  const sockets = [];
  let server;
  let address;
  async function start() {
    server = await createTarokServer({ dataDir, logger: quietLogger, ...options });
    address = await server.listen(0, '127.0.0.1');
  }
  async function stop() {
    sockets.forEach((socket) => socket.disconnect());
    if (server) await server.close();
    server = null;
  }
  t.after(async () => {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  await start();
  return {
    dataDir,
    start,
    stop,
    async get(route) {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`);
      return { response, body: await response.json() };
    },
    async connect(extraHeaders = {}, { transports = ['websocket'] } = {}) {
      const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
        transports,
        reconnection: false,
        forceNew: true,
        extraHeaders,
      });
      sockets.push(socket);
      const listeners = new Set();
      const client = {
        socket,
        state: null,
        request(event, payload) {
          return socket.timeout(5000).emitWithAck(event, payload);
        },
        async waitFor(predicate) {
          if (predicate(client.state)) return client.state;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              listeners.delete(check);
              reject(new Error('Timed out waiting for synchronized hosting test state'));
            }, 5000);
            const check = (state) => {
              if (!predicate(state)) return;
              clearTimeout(timer);
              listeners.delete(check);
              resolve(state);
            };
            listeners.add(check);
          });
        },
      };
      socket.on('state', (state) => {
        client.state = state;
        for (const listener of listeners) listener(state);
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return client;
    },
  };
}

async function create(client, name = 'Ana') {
  return client.request('room:create', { name });
}

async function savedRoomNames(dataDir) {
  return (await readdir(dataDir)).filter((name) => /^[A-HJ-NP-Z2-9]{6}\.json$/.test(name));
}

function assertCreationLimited(result, message, retryAfterMs) {
  assert.equal(result.ok, false, message);
  assert.equal(result.code, 'ROOM_CREATE_LIMIT', 'Rejection must be the creation quota, not an unrelated failure');
  assert.ok(Number.isSafeInteger(result.retryAfterMs) && result.retryAfterMs > 0);
  if (retryAfterMs !== undefined) assert.equal(result.retryAfterMs, retryAfterMs);
}

test('room creation counts malformed attempts across reconnects and ignores untrusted forwarded identities', async (t) => {
  let time = 1_000;
  const host = await fixture(t, {
    creationLimit: { max: 3, windowMs: 60_000, maxKeys: 10 },
    now: () => time,
  });
  const invalid = await host.connect();
  assert.equal((await create(invalid, '')).ok, false);
  invalid.socket.disconnect();

  for (let index = 1; index <= 2; index += 1) {
    const client = await host.connect({
      'X-Forwarded-For': `198.51.100.${index}`,
      'X-Real-IP': `203.0.113.${index}`,
      Forwarded: `for=192.0.2.${index}`,
    });
    assert.equal((await create(client)).ok, true);
    client.socket.disconnect();
  }

  const blocked = await host.connect({
    'X-Forwarded-For': '198.51.100.99',
    'X-Real-IP': '203.0.113.99',
    Forwarded: 'for=192.0.2.99',
  });
  assertCreationLimited(await create(blocked),
    'Reconnecting and changing spoofable headers cannot reset the direct peer quota', 60_000);
  assert.equal((await savedRoomNames(host.dataDir)).length, 2,
    'Rejected attempts must not persist rooms');

  time += 59_999;
  assertCreationLimited(await create(blocked), 'Quota must last for the full configured window', 1);
  time += 1;
  assert.equal((await create(blocked)).ok, true, 'Quota recovers at expiry without a server restart');
  assert.equal((await savedRoomNames(host.dataDir)).length, 3);
});

test('simultaneous sockets cannot race past the shared room creation quota', async (t) => {
  const host = await fixture(t, { creationLimit: { max: 3 } });
  const clients = await Promise.all(Array.from({ length: 8 }, () => host.connect()));
  const results = await Promise.all(clients.map((client) => create(client)));
  assert.equal(results.filter((result) => result.ok).length, 3);
  for (const result of results.filter((result) => !result.ok)) assertCreationLimited(result);
  assert.equal((await savedRoomNames(host.dataDir)).length, 3);
});

test('exhausting creation quota does not block joining, resuming, or legal game actions', async (t) => {
  const host = await fixture(t, { creationLimit: { max: 1 } });
  const ana = await host.connect();
  const anaSession = await create(ana);
  assert.equal(anaSession.ok, true);
  const luka = await host.connect();
  assertCreationLimited(await create(luka, 'Luka'));
  const lukaSession = await luka.request('room:join', { roomId: anaSession.roomId, name: 'Luka' });
  assert.equal(lukaSession.ok, true, 'An invitation still works after room creation is throttled');
  await ana.waitFor((state) => state?.game?.phase === 'bidding');

  ana.socket.disconnect();
  const resumed = await host.connect();
  assertCreationLimited(await create(resumed));
  assert.equal((await resumed.request('room:resume', anaSession)).ok, true);
  assert.equal(resumed.state.you, anaSession.playerId);

  const players = [resumed, luka];
  while (resumed.state.game.phase === 'bidding') {
    const bidder = players.find((player) => player.state.game.legalBids?.length);
    assert.ok(bidder, 'A synchronized player can bid');
    assert.equal((await bidder.request('game:action', { type: 'bid', bid: 'pass' })).ok, true);
    const bids = bidder.state.game.bids.length;
    await Promise.all(players.map((player) => player.waitFor((state) => state?.game?.bids.length === bids)));
  }
  for (const player of players) {
    assert.equal((await player.request('game:action', { type: 'confirmAnnouncements' })).ok, true);
  }
  await Promise.all(players.map((player) => player.waitFor((state) => state?.game?.phase === 'playing')));
  const leader = players.find((player) => player.state.game.legalMoves.length);
  assert.ok(leader);
  const game = leader.state.game;
  assert.equal((await leader.request('game:action', {
    type: 'play',
    cardId: game.legalMoves[0],
    expectedPlay: { round: game.round, trickNumber: game.trickNumber, trickSize: game.trick.length },
  })).ok, true, 'Existing games remain playable when new room creation is throttled');
  assert.equal(leader.state.game.trick.length, 1);
  assert.equal((await savedRoomNames(host.dataDir)).length, 1);
});

test('explicit proxy trust isolates verified client addresses and ignores attacker-controlled earlier hops', async (t) => {
  const host = await fixture(t, {
    creationLimit: { max: 1, windowMs: 60_000, maxKeys: 10 },
    trustedProxies: trustedLoopback,
  });
  const first = await host.connect({ 'X-Forwarded-For': '198.51.100.1' });
  assert.equal((await create(first)).ok, true);
  first.socket.disconnect();
  const same = await host.connect({ 'X-Forwarded-For': '203.0.113.99, 198.51.100.1' });
  assertCreationLimited(await create(same),
    'Only trusted proxy hops may be skipped; an earlier forwarded address cannot reset the client quota');
  const other = await host.connect({ 'X-Forwarded-For': '198.51.100.2' });
  assert.equal((await create(other)).ok, true, 'A different verified client retains its own quota');
  assert.equal((await savedRoomNames(host.dataDir)).length, 2);
});

test('malformed forwarded addresses from a trusted proxy share the actual peer fallback quota', async (t) => {
  const host = await fixture(t, {
    creationLimit: { max: 1 },
    trustedProxies: trustedLoopback,
  });
  const first = await host.connect({ 'X-Forwarded-For': 'not-an-ip' });
  assert.equal((await create(first)).ok, true);
  first.socket.disconnect();
  for (const forwarded of [
    'also-not-an-ip',
    'for=198.51.100.10',
    '198.51.100.10:1234',
    '[2001:db8::1]',
    '198.51.100.99, malformed-nearest-hop',
    '',
  ]) {
    const client = await host.connect({ 'X-Forwarded-For': forwarded });
    assertCreationLimited(await create(client),
      `Malformed forwarded value ${JSON.stringify(forwarded)} cannot create a new quota identity`);
    client.socket.disconnect();
  }
  const directPeer = await host.connect();
  assertCreationLimited(await create(directPeer), 'Invalid forwarded addresses use the same actual-peer bucket');
  assert.equal((await savedRoomNames(host.dataDir)).length, 1);
});

test('switching from HTTP polling to a new WebSocket connection does not reset the client quota', async (t) => {
  const host = await fixture(t, {
    creationLimit: { max: 1 },
    trustedProxies: trustedLoopback,
  });
  const headers = { 'X-Forwarded-For': '198.51.100.10' };
  const polling = await host.connect(headers, { transports: ['polling'] });
  assert.equal(polling.socket.io.engine.transport.name, 'polling');
  assert.equal((await create(polling)).ok, true);
  polling.socket.disconnect();

  const websocket = await host.connect(headers);
  assert.equal(websocket.socket.io.engine.transport.name, 'websocket');
  assertCreationLimited(await create(websocket), 'Both transports must resolve the same verified client identity');
  assert.equal((await savedRoomNames(host.dataDir)).length, 1);
});

test('unsafe or malformed proxy trust and nonpositive creation limits reject startup', async (t) => {
  for (const trustedProxies of [
    true,
    ['loopback'],
    ['0.0.0.0/0'],
    ['::/0'],
    ['::ffff:0.0.0.0/96'],
    ['::ffff:0:0/96'],
    ['::ffff:192.0.2.1/120'],
    ['127.0.0.1/33'],
    ['::1/129'],
    ['127.0.0.1/not-a-prefix'],
    ['127.0.0.1/8/24'],
  ]) {
    await assert.rejects(() => fixture(t, { trustedProxies }), { name: 'TypeError' },
      `Invalid proxy trust ${JSON.stringify(trustedProxies)} must fail closed before listening`);
  }
  for (const creationLimit of [{ max: 0 }, { windowMs: 0 }, { maxKeys: 0 }]) {
    await assert.rejects(() => fixture(t, { creationLimit }), { name: 'TypeError' },
      `Invalid quota ${JSON.stringify(creationLimit)} must fail startup instead of disabling limits`);
  }
});

test('an exact IPv4-mapped proxy address is allowed and resolves its forwarded client', async (t) => {
  const host = await fixture(t, {
    creationLimit: { max: 1 },
    trustedProxies: ['::ffff:127.0.0.1'],
  });
  const first = await host.connect({ 'X-Forwarded-For': '198.51.100.1' });
  assert.equal((await create(first)).ok, true);
  const repeated = await host.connect({ 'X-Forwarded-For': '198.51.100.1' });
  assertCreationLimited(await create(repeated));
  const other = await host.connect({ 'X-Forwarded-For': '198.51.100.2' });
  assert.equal((await create(other)).ok, true, 'Exact mapped trust must not collapse distinct verified clients');
  assert.equal((await savedRoomNames(host.dataDir)).length, 2);
});

test('creation limiter does not evict live identities when its bounded key capacity is full', async (t) => {
  let time = 1_000;
  const host = await fixture(t, {
    creationLimit: { max: 1, windowMs: 60_000, maxKeys: 2 },
    trustedProxies: trustedLoopback,
    now: () => time,
  });
  for (const address of ['198.51.100.1', '198.51.100.2']) {
    const client = await host.connect({ 'X-Forwarded-For': address });
    assert.equal((await create(client)).ok, true);
    client.socket.disconnect();
  }
  const extra = await host.connect({ 'X-Forwarded-For': '198.51.100.3' });
  assertCreationLimited(await create(extra), 'New identities fail closed at the bounded capacity', 60_000);
  const firstAgain = await host.connect({ 'X-Forwarded-For': '198.51.100.1' });
  assertCreationLimited(await create(firstAgain), 'Key churn must not discard the original active quota', 60_000);
  time += 60_000;
  assert.equal((await create(extra)).ok, true, 'Expired entries release limiter capacity');
  assert.equal((await savedRoomNames(host.dataDir)).length, 3);
});

test('readiness reports degraded restoration without leaking or changing saved games, and repair restores readiness', async (t) => {
  const host = await fixture(t);
  const intact = await host.connect();
  const intactSession = await create(intact, 'Ana');
  assert.equal(intactSession.ok, true);
  const broken = await host.connect();
  const brokenSession = await create(broken, 'Luka');
  assert.equal(brokenSession.ok, true);
  const brokenPath = path.join(host.dataDir, `${brokenSession.roomId}.json`);
  const original = await readFile(brokenPath);
  await host.stop();

  // Deliberately damage only a disposable test save; keep recognizable private strings
  // so the exact public response assertions below also detect accidental leakage.
  const corrupt = Buffer.from(`{"id":"${brokenSession.roomId}","token":"${brokenSession.token}","hand":["tarok-22"]`);
  await writeFile(brokenPath, corrupt);
  await host.start();

  const liveness = await host.get('/health');
  assert.equal(liveness.response.status, 200);
  assert.deepEqual(liveness.body, { ok: true }, 'Restoration failure must not cause liveness restart loops');
  const degraded = await host.get('/ready');
  assert.equal(degraded.response.status, 503);
  assert.deepEqual(degraded.body, { ok: false, restoration: { status: 'degraded', failedRooms: 1 } });
  assert.match(degraded.response.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(await readFile(brokenPath), corrupt, 'Corrupt saves remain byte-identical for recovery');

  const restored = await host.connect();
  assert.equal((await restored.request('room:resume', intactSession)).ok, true,
    'One damaged save must not prevent healthy rooms from restoring');
  const unavailable = await host.connect();
  assert.equal((await unavailable.request('room:resume', brokenSession)).ok, false);
  assert.equal(unavailable.state, null, 'Failed restoration must not expose any private state');
  assert.equal((await create(unavailable, 'Miha')).ok, true,
    'Degraded restoration should be visible without shutting down healthy service');
  assert.deepEqual(await readFile(brokenPath), corrupt, 'Unrelated room creation must retain the corrupt save');

  await host.stop();
  await writeFile(brokenPath, original);
  await host.start();
  const ready = await host.get('/ready');
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { ok: true, restoration: { status: 'ok', failedRooms: 0 } });
  assert.match(ready.response.headers.get('cache-control') || '', /no-store/);
  const recovered = await host.connect();
  assert.equal((await recovered.request('room:resume', brokenSession)).ok, true);
  assert.equal(recovered.state.you, brokenSession.playerId);
  assert.deepEqual(await readFile(brokenPath), original, 'Repair and resume must not rewrite a recovered save');
});

test('clean empty servers expose separate live and ready responses without saved-room detail', async (t) => {
  const host = await fixture(t);
  const health = await host.get('/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { ok: true });
  const ready = await host.get('/ready');
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { ok: true, restoration: { status: 'ok', failedRooms: 0 } });
  assert.match(ready.response.headers.get('cache-control') || '', /no-store/);
});
