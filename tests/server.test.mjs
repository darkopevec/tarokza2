import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { io as connectSocket } from 'socket.io-client';
import { createTarokServer } from '../server/index.mjs';
import * as gameEngine from '../shared/game.mjs';

const quietLogger = { warn() {}, error() {} };

async function client(address) {
  const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const listeners = new Set();
  const connection = {
    socket,
    state: null,
    stateCount: 0,
    async request(event, payload) {
      return socket.timeout(5000).emitWithAck(event, payload);
    },
    async waitFor(predicate) {
      if (predicate(connection.state)) return connection.state;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error('Timed out waiting for synchronized state'));
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
    connection.state = state;
    connection.stateCount += 1;
    for (const listener of listeners) listener(state);
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return connection;
}

function stamp(state) {
  const game = state?.game;
  return JSON.stringify(game && [
    game.round, game.phase, game.turn, game.trickNumber,
    game.trick?.length, game.bids?.length, game.ready,
    game.players.map(({ handCount, stacks, trickCount, score }) => ({
      handCount, stacks, trickCount, score,
    })),
    game.pickups,
    game.announcements,
    game.announcementReady,
    game.mondfangs,
    game.scoringVersion,
  ]);
}

function playContext(game) {
  return { round: game.round, trickNumber: game.trickNumber, trickSize: game.trick.length };
}

async function move(clients, index, action) {
  const payload = action.type === 'play' && !Object.hasOwn(action, 'expectedPlay')
    ? { ...action, expectedPlay: playContext(clients[index].state.game) }
    : action;
  const result = await clients[index].request('game:action', payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  const expected = stamp(clients[index].state);
  await Promise.all(clients.map((current) => current.waitFor((state) => stamp(state) === expected)));
}

async function confirmAnnouncements(clients) {
  assert.equal(clients[0].state.game.phase, 'announcements');
  await move(clients, 0, { type: 'confirmAnnouncements' });
  assert.equal(clients[0].state.game.phase, 'announcements',
    'One confirmation must not start card play');
  assert.deepEqual(clients[0].state.game.announcementReady, [true, false]);
  assert.deepEqual(clients[0].state.game.legalMoves, []);
  await move(clients, 1, { type: 'confirmAnnouncements' });
  assert.equal(clients[0].state.game.phase, 'playing');
}

test('private multiplayer games complete two rounds, preserve seats, and survive restart', { timeout: 30_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-server-test-'));
  let server = await createTarokServer({ dataDir, logger: quietLogger });
  let address = await server.listen(0, '127.0.0.1');
  const sockets = [];
  const openClient = async () => {
    const connection = await client(address);
    sockets.push(connection.socket);
    return connection;
  };
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.deepEqual(await response.json(), { ok: true });
  const ana = await openClient();
  const anaSession = await ana.request('room:create', { name: 'Ana' });
  assert.equal(anaSession.ok, true);
  assert.match(anaSession.roomId, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(ana.state.game, null);
  assert.equal(ana.state.players.length, 1);

  const luka = await openClient();
  const lukaSession = await luka.request('room:join', { roomId: anaSession.roomId.toLowerCase(), name: 'Luka' });
  assert.equal(lukaSession.ok, true);
  await ana.waitFor((state) => state?.game?.phase === 'bidding');
  assert.equal(ana.state.you, anaSession.playerId);
  assert.equal(luka.state.you, lukaSession.playerId);
  assert.equal(ana.state.players.length, 2);
  assert.deepEqual(ana.state.players.map(({ connected }) => connected), [true, true]);
  const anaCards = new Set(ana.state.game.hand.map(({ id }) => id));
  assert.ok(luka.state.game.hand.every(({ id }) => !anaCards.has(id)), 'Players receive only their own private hand');
  assert.ok(!JSON.stringify(ana.state).includes(lukaSession.token));
  assert.ok(!JSON.stringify(luka.state).includes(anaSession.token));
  assert.ok(ana.state.players.every((player) => !('tokenHash' in player)));
  const saved = await readFile(path.join(dataDir, `${anaSession.roomId}.json`), 'utf8');
  assert.ok(!saved.includes(anaSession.token), 'Raw reconnect credentials must never be persisted');
  assert.ok(!saved.includes(lukaSession.token));

  const stranger = await openClient();
  assert.equal((await stranger.request('room:join', { roomId: anaSession.roomId, name: 'Tretji' })).ok, false);
  assert.equal((await stranger.request('room:resume', { roomId: anaSession.roomId, token: 'wrong' })).ok, false);
  assert.equal((await stranger.request('game:action', { type: 'bid', bid: 'play', playerId: anaSession.playerId })).ok, false);
  assert.equal(stranger.state, null, 'Unauthenticated sockets receive no room state');

  const clients = [ana, luka];
  for (let round = 1; round <= 2; round += 1) {
    assert.equal(ana.state.game.round, round);
    while (ana.state.game.phase === 'bidding') {
      const index = clients.findIndex((current) => current.state.game.legalBids?.length);
      assert.notEqual(index, -1, 'A player can always bid during bidding');
      await move(clients, index, { type: 'bid', bid: round === 1 ? 'pass' : 'play' });
    }
    await confirmAnnouncements(clients);
    let played = 0;
    while (ana.state.game.phase === 'playing') {
      const index = clients.findIndex((current) => current.state.game.legalMoves?.length);
      assert.notEqual(index, -1, 'A player always has a legal card during play');
      const cardId = clients[index].state.game.legalMoves[0];
      if (played === 0) {
        const before = JSON.stringify(clients[1 - index].state.game);
        const illegal = await clients[1 - index].request('game:action', {
          type: 'play', cardId, expectedPlay: playContext(clients[1 - index].state.game),
        });
        assert.equal(illegal.ok, false, 'Out-of-turn play must be rejected');
        assert.equal(JSON.stringify(clients[1 - index].state.game), before);
      }
      await move(clients, index, { type: 'play', cardId });
      played += 1;
      assert.ok(played <= 54, 'A round cannot play more cards than the deck');
    }
    assert.equal(played, 54);
    assert.equal(ana.state.game.phase, 'roundEnd');
    assert.equal(ana.state.game.scoreboard.length, round);
    assert.deepEqual(ana.state.game.scoreboard, luka.state.game.scoreboard);
    const result = ana.state.game.scoreboard.at(-1);
    assert.equal(result.exactPoints.reduce((sum, value) => sum + value, 0), 70);
    await move(clients, 0, { type: 'ready' });
    assert.equal(ana.state.game.phase, 'roundEnd', 'Both players must be ready before the next deal');
    if (round === 1) await move(clients, 1, { type: 'ready' });
  }

  // A browser refresh and a server restart must restore the same seat and scoreboard.
  const expectedGame = cloneForComparison(ana.state.game);
  ana.socket.disconnect();
  await luka.waitFor((state) => state?.players[0]?.connected === false);
  assert.equal((await stranger.request('room:join', { roomId: anaSession.roomId, name: 'Tretji' })).ok, false,
    'A disconnected seat stays reserved');
  const refreshed = await openClient();
  assert.equal((await refreshed.request('room:resume', anaSession)).ok, true);
  assert.deepEqual(cloneForComparison(refreshed.state.game), expectedGame);
  sockets.forEach((socket) => socket.disconnect());
  await server.close();

  server = await createTarokServer({ dataDir, logger: quietLogger });
  address = await server.listen(0, '127.0.0.1');
  const restoredAna = await openClient();
  const restoredLuka = await openClient();
  assert.equal((await restoredAna.request('room:resume', anaSession)).ok, true);
  assert.equal((await restoredLuka.request('room:resume', lukaSession)).ok, true);
  await restoredAna.waitFor((state) => state?.players.every(({ connected }) => connected));
  assert.deepEqual(cloneForComparison(restoredAna.state.game), expectedGame);
  assert.equal(restoredAna.state.game.scoreboard.length, 2);
  await move([restoredAna, restoredLuka], 1, { type: 'ready' });
  assert.equal(restoredAna.state.game.round, 3);
  assert.equal(restoredAna.state.game.phase, 'bidding');
  assert.equal(restoredAna.state.game.scoreboard.length, 2);
});

function cloneForComparison(value) {
  return JSON.parse(JSON.stringify(value));
}

// Keep every card in a valid 54-card deal, with known exposed and hidden honors.
// Only the initial deal is controlled; all requests use the production action/view code.
const pickupFixtureEngine = {
  ...gameEngine,
  createGame(options) {
    const game = gameEngine.createGame({ ...options, dealer: 0 });
    const stackIds = [
      [
        ['tarok-22', 'tarok-21', 'clubs-8', 'clubs-1'],
        ['hearts-8', 'hearts-1', 'hearts-2', 'hearts-3'],
        ['spades-1', 'tarok-20', 'spades-2', 'spades-3'],
      ],
      [
        ['tarok-19', 'tarok-18', 'diamonds-8', 'diamonds-1'],
        ['spades-8', 'spades-4', 'spades-5', 'spades-6'],
        ['diamonds-2', 'tarok-17', 'diamonds-3', 'diamonds-4'],
      ],
    ];
    const deck = gameEngine.createDeck();
    const byId = new Map(deck.map((card) => [card.id, card]));
    const inStacks = new Set(stackIds.flat(2));
    const remaining = deck.filter((card) => !inStacks.has(card.id));
    for (const [index, player] of game.players.entries()) {
      player.hand = remaining.slice(index * 15, (index + 1) * 15);
      player.stacks = stackIds[index].map((stack) => stack.map((id) => byId.get(id)));
    }
    return game;
  },
};

function unchangedByPickup(game) {
  return cloneForComparison({
    phase: game.phase,
    round: game.round,
    turn: game.turn,
    trick: game.trick,
    trickNumber: game.trickNumber,
    lastTrick: game.lastTrick,
    contract: game.contract,
    bids: game.bids,
    ready: game.ready,
    scoreboard: game.scoreboard,
    players: game.players.map(({ trickCount, score }) => ({ trickCount, score })),
  });
}

async function setupRoom(t, engine) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-announcement-test-'));
  let server = await createTarokServer({ dataDir, engine, logger: quietLogger });
  let address;
  let clients;
  let sessions;
  const sockets = [];
  const openClients = async () => Promise.all([0, 1].map(async () => {
    const current = await client(address);
    sockets.push(current.socket);
    return current;
  }));
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  address = await server.listen(0, '127.0.0.1');
  clients = await openClients();
  const first = await clients[0].request('room:create', { name: 'Ana' });
  const second = await clients[1].request('room:join', { roomId: first.roomId, name: 'Luka' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  sessions = [first, second];
  await clients[0].waitFor((state) => !!state?.game);
  const roomFile = path.join(dataDir, `${first.roomId}.json`);
  return {
    get clients() { return clients; },
    sessions,
    roomFile,
    async openTab(index) {
      const current = await client(address);
      sockets.push(current.socket);
      assert.equal((await current.request('room:resume', sessions[index])).ok, true);
      return current;
    },
    async reject(index, action, reason) {
      const before = clients.map((current) => cloneForComparison(current.state.game));
      const diskBefore = await readFile(roomFile, 'utf8');
      const response = await clients[index].request('game:action', action);
      assert.equal(response.ok, false, reason);
      assert.deepEqual(clients.map((current) => current.state.game), before,
        `${reason}: neither private view changes`);
      assert.equal(await readFile(roomFile, 'utf8'), diskBefore,
        `${reason}: the saved game does not change`);
      return response;
    },
    async restart() {
      const expected = clients.map((current) => cloneForComparison(current.state.game));
      sockets.forEach((socket) => socket.disconnect());
      await server.close();
      server = await createTarokServer({ dataDir, engine, logger: quietLogger });
      address = await server.listen(0, '127.0.0.1');
      clients = await openClients();
      for (let index = 0; index < 2; index += 1) {
        assert.equal((await clients[index].request('room:resume', sessions[index])).ok, true);
      }
      await clients[0].waitFor((state) => state?.players.every(({ connected }) => connected));
      assert.deepEqual(clients.map((current) => current.state.game), expected,
        'Restart must restore both private views and public preparation state exactly');
    },
  };
}

const announcementFixtureEngine = {
  ...gameEngine,
  createGame(options) {
    const game = gameEngine.createGame({ ...options, dealer: 0 });
    const handIds = [
      'clubs-8', 'spades-8', 'hearts-8', 'diamonds-8',
      ...Array.from({ length: 10 }, (_, index) => `tarok-${index + 1}`),
      'clubs-1',
    ];
    const stackIds = [
      ['tarok-22', 'tarok-21', 'tarok-20', 'tarok-11'],
      ['tarok-19', 'tarok-18', 'tarok-17', 'tarok-12'],
      ['tarok-16', 'tarok-15', 'tarok-14', 'tarok-13'],
    ];
    const deck = gameEngine.createDeck();
    const byId = new Map(deck.map((card) => [card.id, card]));
    const ownIds = new Set([...handIds, ...stackIds.flat()]);
    const other = deck.filter((card) => !ownIds.has(card.id));
    game.players[0].hand = handIds.map((id) => byId.get(id));
    game.players[0].stacks = stackIds.map((stack) => stack.map((id) => byId.get(id)));
    game.players[1].hand = other.slice(0, 15);
    game.players[1].stacks = [other.slice(15, 19), other.slice(19, 23), other.slice(23, 27)];
    return game;
  },
};

test('private announcement eligibility, frozen preparation, restart, and bonus scores synchronize', { timeout: 30_000 }, async (t) => {
  const room = await setupRoom(t, announcementFixtureEngine);
  await room.reject(0, { type: 'announce', bonus: 'kings' }, 'Bonuses cannot be announced during bidding');
  await room.reject(0, { type: 'confirmAnnouncements' }, 'Preparation cannot be confirmed before bidding ends');
  await move(room.clients, 1, { type: 'bid', bid: 'play' });
  const initial = room.clients[0].state.game;
  assert.equal(initial.phase, 'announcements');
  assert.equal(initial.scoringVersion, 2);
  assert.deepEqual(initial.announcementReady, [false, false]);
  assert.deepEqual(initial.announcements, []);
  assert.ok(initial.legalAnnouncements.includes('kings'), 'Four kings in the owner’s hand qualify privately');
  assert.ok(!initial.legalAnnouncements.includes('trula'), 'An exposed stack honor does not count as a card in hand');
  assert.ok(!initial.legalAnnouncements.includes('valat'), 'Covered stack cards prevent valat');
  assert.deepEqual(room.clients[1].state.game.legalAnnouncements, [], 'The opponent cannot inspect private eligibility');
  assert.ok(initial.players.every((player) => !('hand' in player) && !('legalAnnouncements' in player)));
  assert.ok(initial.players.every((player) => player.stacks.every((stack) => stack.top !== null)),
    'Pile tops are public during preparation');
  assert.ok(room.clients.every((current) => current.state.game.legalMoves.length === 0));
  const earlyPlay = await room.reject(1, {
    type: 'play', cardId: room.clients[1].state.game.hand[0].id,
    expectedPlay: playContext(room.clients[1].state.game),
  }, 'Card play is blocked during preparation');
  assert.equal(earlyPlay.code, 'STALE_PLAY');
  await room.reject(1, { type: 'announce', bonus: 'kings', playerId: room.sessions[0].playerId },
    'Supplying another player ID cannot announce their private kings');
  await room.reject(0, { type: 'announce', bonus: 'trula' }, 'Trula requires all three cards in hand');
  await room.reject(0, { type: 'announce', bonus: 'valat' }, 'Valat is rejected while cards remain hidden');
  await room.reject(0, { type: 'announce', bonus: 'unknown' }, 'Unknown bonus names are rejected');

  await move(room.clients, 0, { type: 'announce', bonus: 'kings' });
  assert.deepEqual(room.clients[1].state.game.announcements, [{ player: 0, bonus: 'kings' }]);
  await room.reject(0, { type: 'announce', bonus: 'kings' }, 'The same bonus cannot be announced twice');
  await move(room.clients, 0, { type: 'pickup', cardId: 'tarok-22' });
  assert.ok(!room.clients[0].state.game.legalAnnouncements.includes('trula'));
  await move(room.clients, 0, { type: 'pickup', cardId: 'tarok-21' });
  assert.ok(room.clients[0].state.game.legalAnnouncements.includes('trula'));
  assert.ok(!room.clients[1].state.game.legalAnnouncements.includes('trula'));
  await move(room.clients, 0, { type: 'announce', bonus: 'trula' });

  for (const cardId of ['tarok-20', 'tarok-19', 'tarok-18', 'tarok-17', 'tarok-16', 'tarok-15', 'tarok-14']) {
    await move(room.clients, 0, { type: 'pickup', cardId });
  }
  const prepared = room.clients[0].state.game;
  assert.equal(prepared.hand.length, 24);
  assert.deepEqual(prepared.players[0].stacks.map(({ count }) => count), [1, 1, 1]);
  assert.ok(prepared.legalAnnouncements.includes('valat'),
    'Valat is legal with three face-up pile cards still outside the hand');
  assert.deepEqual(new Set(prepared.legalPickups), new Set(['tarok-11', 'tarok-12', 'tarok-13']));
  await move(room.clients, 0, { type: 'announce', bonus: 'valat' });
  assert.deepEqual(room.clients[1].state.game.announcements, [
    { player: 0, bonus: 'kings' }, { player: 0, bonus: 'trula' }, { player: 0, bonus: 'valat' },
  ]);
  await move(room.clients, 0, { type: 'confirmAnnouncements' });
  assert.equal(room.clients[0].state.game.phase, 'announcements');
  assert.deepEqual(room.clients[1].state.game.announcementReady, [true, false]);
  assert.deepEqual(room.clients[0].state.game.legalPickups, []);
  assert.deepEqual(room.clients[0].state.game.legalAnnouncements, []);
  await room.reject(0, { type: 'pickup', cardId: 'tarok-11' }, 'Own confirmation freezes an otherwise legal pickup');
  await room.reject(0, { type: 'announce', bonus: 'kings' }, 'Own confirmation freezes bonus announcements');
  await room.reject(1, { type: 'play', cardId: room.clients[1].state.game.hand[0].id,
    expectedPlay: playContext(room.clients[1].state.game) },
    'One confirmation is insufficient to begin play');

  await room.restart();
  assert.equal(room.clients[0].state.game.phase, 'announcements');
  assert.deepEqual(room.clients[0].state.game.announcementReady, [true, false]);
  await room.reject(0, { type: 'pickup', cardId: 'tarok-11' }, 'The preparation freeze survives reconnect and restart');
  await move(room.clients, 1, { type: 'confirmAnnouncements' });
  assert.equal(room.clients[0].state.game.phase, 'playing');
  assert.ok(room.clients[0].state.game.legalPickups.includes('tarok-11'),
    'Optional pickups are available again once card play starts');
  await move(room.clients, 0, { type: 'pickup', cardId: 'tarok-11' });

  let played = 0;
  while (room.clients[0].state.game.phase === 'playing') {
    const index = room.clients.findIndex((current) => current.state.game.legalMoves.length > 0);
    assert.notEqual(index, -1);
    await move(room.clients, index, { type: 'play', cardId: room.clients[index].state.game.legalMoves[0] });
    played += 1;
    assert.ok(played <= 54);
  }
  assert.equal(played, 54);
  const result = room.clients[0].state.game.scoreboard[0];
  assert.deepEqual(result, room.clients[1].state.game.scoreboard[0]);
  assert.equal(result.scoringVersion, 2);
  assert.deepEqual(result.announcements, prepared.announcements.concat({ player: 0, bonus: 'valat' }));
  const valat = result.breakdown.find((entry) => entry.kind === 'valat');
  assert.ok(valat);
  assert.equal(valat.player, 0);
  assert.equal(valat.announced, true);
  assert.equal(valat.success, room.clients[0].state.game.players[0].trickCount === 27);
  assert.equal(valat.points, valat.success ? 500 : -500);
  assert.ok(result.breakdown.every((entry) => !['game', 'kings', 'trula'].includes(entry.kind)),
    'Called valat replaces game and set-bonus scoring');
  for (const player of [0, 1]) {
    const total = result.breakdown.filter((entry) => entry.player === player)
      .reduce((sum, entry) => sum + entry.points, 0);
    assert.equal(result.deltas[player], total);
    assert.equal(result.totals[player], total);
  }
  await room.restart();
  assert.deepEqual(room.clients[0].state.game.scoreboard[0], result,
    'The synchronized bonus breakdown survives server restart');
});

const legacyFixtureEngine = {
  ...gameEngine,
  createGame(options) {
    const game = gameEngine.createGame({ ...options, dealer: 0 });
    const deck = gameEngine.createDeck();
    const byId = new Map(deck.map((card) => [card.id, card]));
    const lastCards = ['tarok-2', 'hearts-1'];
    const remaining = deck.filter((card) => !lastCards.includes(card.id));
    game.scoringVersion = 1;
    game.phase = 'playing';
    game.turn = 0;
    game.trickNumber = 27;
    game.players[0].hand = [byId.get(lastCards[0])];
    game.players[1].hand = [byId.get(lastCards[1])];
    game.players[0].stacks = [[], [], []];
    game.players[1].stacks = [[], [], []];
    game.players[0].captured = remaining;
    game.players[1].captured = [];
    game.players[0].trickCount = 26;
    game.players[1].trickCount = 0;
    return game;
  },
};

test('an underway legacy round retains its scoring until the next deal', { timeout: 30_000 }, async (t) => {
  const room = await setupRoom(t, legacyFixtureEngine);
  assert.equal(room.clients[0].state.game.scoringVersion, 1);
  await room.restart();
  assert.equal(room.clients[0].state.game.scoringVersion, 1);
  await move(room.clients, 0, { type: 'play', cardId: 'tarok-2' });
  await move(room.clients, 1, { type: 'play', cardId: 'hearts-1' });
  const result = room.clients[0].state.game.scoreboard[0];
  assert.deepEqual(result.deltas, [35, 0],
    'A legacy 70-point sweep keeps the original +35 score instead of introducing a valat bonus');
  assert.deepEqual(result, room.clients[1].state.game.scoreboard[0]);
  await move(room.clients, 0, { type: 'ready' });
  await move(room.clients, 1, { type: 'ready' });
  assert.equal(room.clients[0].state.game.scoringVersion, 2);
  assert.equal(room.clients[0].state.game.round, 2);
  while (room.clients[0].state.game.phase === 'bidding') {
    const index = room.clients.findIndex((current) => current.state.game.legalBids.length > 0);
    await move(room.clients, index, { type: 'bid', bid: 'pass' });
  }
  await confirmAnnouncements(room.clients);
  assert.deepEqual(room.clients[0].state.game.scoreboard[0].deltas, [35, 0]);
  const firstPlayer = room.clients.findIndex((current) => current.state.game.legalMoves.length > 0);
  const previousRoundPlay = await room.reject(firstPlayer, {
    type: 'play', cardId: room.clients[firstPlayer].state.game.legalMoves[0],
    expectedPlay: { ...playContext(room.clients[firstPlayer].state.game), round: 1 },
  }, 'A context from the previous round cannot play a card in the new deal');
  assert.equal(previousRoundPlay.code, 'STALE_PLAY');
});

function finalBonusTrickEngine(mode) {
  return {
    ...gameEngine,
    createGame(options) {
      const game = gameEngine.createGame({ ...options, dealer: 0 });
      const deck = gameEngine.createDeck();
      const byId = new Map(deck.map((card) => [card.id, card]));
      const kings = ['clubs-8', 'spades-8', 'hearts-8', 'diamonds-8'];
      const last = mode === 'silent' ? ['tarok-2', 'hearts-1'] : ['tarok-21', 'tarok-22'];
      const priority = mode === 'silent'
        ? [...kings, 'tarok-1', 'tarok-21', 'tarok-22']
        : mode === 'called' ? [...kings, 'tarok-1'] : ['tarok-1'];
      const remaining = deck.filter((card) => !last.includes(card.id));
      const ownCaptured = priority.map((id) => byId.get(id));
      for (const card of remaining) {
        if (ownCaptured.length >= 40) break;
        if (priority.includes(card.id) || (mode === 'failedKings' && kings.includes(card.id))) continue;
        ownCaptured.push(card);
      }
      const ownIds = new Set(ownCaptured.map((card) => card.id));
      game.scoringVersion = 2;
      game.phase = 'playing';
      game.turn = 0;
      game.trickNumber = 27;
      game.announcementReady = [true, true];
      game.announcements = mode === 'silent' ? [] : mode === 'called'
        ? [{ player: 0, bonus: 'kings' }, { player: 0, bonus: 'trula' }]
        : [{ player: 0, bonus: 'kings' }];
      for (const player of [0, 1]) {
        game.players[player].hand = [byId.get(last[player])];
        game.players[player].stacks = [[], [], []];
      }
      game.players[0].captured = ownCaptured;
      game.players[1].captured = remaining.filter((card) => !ownIds.has(card.id));
      game.players[0].trickCount = 20;
      game.players[1].trickCount = 6;
      return game;
    },
  };
}

test('silent sets, called sets, opposing silent sets, and mondfang share the same socket score', { timeout: 30_000 }, async (t) => {
  for (const mode of ['silent', 'called', 'failedKings']) {
    await t.test(mode, async (scenario) => {
      const room = await setupRoom(scenario, finalBonusTrickEngine(mode));
      await move(room.clients, 0, { type: 'play', cardId: room.clients[0].state.game.hand[0].id });
      assert.deepEqual(room.clients[0].state.game.mondfangs, [], 'Mondfang requires the completed XXI–Škis trick');
      if (mode === 'called') await room.restart();
      await move(room.clients, 1, { type: 'play', cardId: room.clients[1].state.game.hand[0].id });
      const game = room.clients[0].state.game;
      const result = game.scoreboard[0];
      assert.deepEqual(room.clients[1].state.game.scoreboard[0], result);
      const bonuses = result.breakdown.filter((entry) => entry.kind !== 'game');
      if (mode === 'silent') {
        assert.deepEqual(bonuses, [
          { player: 0, kind: 'kings', points: 10, announced: false, success: true },
          { player: 0, kind: 'trula', points: 10, announced: false, success: true },
        ]);
        assert.deepEqual(game.mondfangs, []);
      } else {
        const expectedSets = mode === 'called' ? [
          { player: 0, kind: 'kings', points: 20, announced: true, success: true },
          { player: 0, kind: 'trula', points: -20, announced: true, success: false },
        ] : [
          { player: 0, kind: 'kings', points: -20, announced: true, success: false },
          { player: 1, kind: 'kings', points: 10, announced: false, success: true },
        ];
        assert.deepEqual(bonuses, [...expectedSets,
          { player: 0, kind: 'mondfang', points: -21, trickNumber: 27 },
        ]);
        assert.deepEqual(game.mondfangs, [{ player: 0, winner: 1, trickNumber: 27 }]);
        assert.deepEqual(room.clients[1].state.game.mondfangs, game.mondfangs);
      }
      for (const player of [0, 1]) {
        const total = result.breakdown.filter((entry) => entry.player === player)
          .reduce((sum, entry) => sum + entry.points, 0);
        assert.equal(result.deltas[player], total);
        assert.equal(result.totals[player], total);
      }
    });
  }
});

test('optional honor pickups synchronize privately, reject illegal requests, and persist mid-trick', { timeout: 30_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-pickup-test-'));
  let server = await createTarokServer({ dataDir, engine: pickupFixtureEngine, logger: quietLogger });
  let address;
  const sockets = [];
  const openClient = async () => {
    const connection = await client(address);
    sockets.push(connection.socket);
    return connection;
  };
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  address = await server.listen(0, '127.0.0.1');
  let clients = [await openClient(), await openClient()];
  const anaSession = await clients[0].request('room:create', { name: 'Ana' });
  assert.equal(anaSession.ok, true);
  const lukaSession = await clients[1].request('room:join', { roomId: anaSession.roomId, name: 'Luka' });
  assert.equal(lukaSession.ok, true);
  await clients[0].waitFor((state) => state?.game?.phase === 'bidding');
  const roomFile = path.join(dataDir, `${anaSession.roomId}.json`);

  async function rejectPickup(index, cardId, reason) {
    const before = clients.map((current) => cloneForComparison(current.state.game));
    const diskBefore = await readFile(roomFile, 'utf8');
    const result = await clients[index].request('game:action', { type: 'pickup', cardId });
    assert.equal(result.ok, false, reason);
    assert.deepEqual(clients.map((current) => current.state.game), before,
      `${reason}: neither player's view changes`);
    assert.equal(await readFile(roomFile, 'utf8'), diskBefore,
      `${reason}: the authoritative save does not change`);
  }

  async function pickup(index, cardId, stackIndex, expectedNextTop) {
    const before = cloneForComparison(clients[index].state.game);
    const untouched = unchangedByPickup(before);
    await move(clients, index, { type: 'pickup', cardId });
    const after = clients[index].state.game;
    assert.deepEqual(unchangedByPickup(after), untouched,
      'Picking up preserves the current turn, trick, phase, and score');
    assert.equal(after.hand.length, before.hand.length + 1, 'Exactly one card enters the hand');
    assert.ok(after.hand.some((card) => card.id === cardId));
    assert.equal(after.players[index].handCount, before.players[index].handCount + 1);
    assert.equal(after.players[index].stacks[stackIndex].count,
      before.players[index].stacks[stackIndex].count - 1);
    const nextTop = after.players[index].stacks[stackIndex].top;
    assert.equal(nextTop?.id, expectedNextTop,
      'The next top remains on the stack, even when it is another honor');
    assert.ok(!after.legalPickups.includes(cardId));
    assert.equal(after.legalPickups.includes(expectedNextTop),
      nextTop?.suit === 'tarok' || nextTop?.rank === 8,
      'The newly exposed card is eligible only when it is an honor');
    assert.equal(after.pickups.length, before.pickups.length + 1);
    assert.deepEqual(after.pickups.at(-1), {
      player: index,
      card: after.hand.find((card) => card.id === cardId),
      stack: stackIndex,
      trickNumber: after.trickNumber,
    });
    const other = clients[1 - index].state.game;
    assert.deepEqual(other.players, after.players, 'Hand counts and exposed stack cards synchronize publicly');
    assert.deepEqual(other.pickups, after.pickups, 'Both players retain identical public pickup history');
    assert.ok(!other.hand.some((card) => card.id === cardId), 'The card is added only to its owner’s private hand');
  }

  for (const current of clients) {
    assert.deepEqual(current.state.game.legalPickups, []);
    assert.ok(current.state.game.players.every((player) => player.stacks.every((stack) => stack.top === null)));
  }
  await rejectPickup(0, 'tarok-22', 'Honors cannot be taken during bidding');
  await rejectPickup(1, 'spades-8', 'Kings cannot be taken during bidding');
  await move(clients, 1, { type: 'bid', bid: 'play' });
  assert.deepEqual(clients[0].state.game.players.map(({ handCount }) => handCount), [15, 15],
    'Starting play never moves exposed honors automatically');
  assert.deepEqual(clients[0].state.game.pickups, []);
  assert.deepEqual(new Set(clients[0].state.game.legalPickups), new Set(['tarok-22', 'hearts-8']));
  assert.deepEqual(new Set(clients[1].state.game.legalPickups), new Set(['tarok-19', 'spades-8']));
  await confirmAnnouncements(clients);

  await rejectPickup(0, 'tarok-19', 'A player cannot take an opponent’s exposed honor');
  await rejectPickup(0, 'spades-1', 'An ordinary exposed suit card cannot be taken');
  await rejectPickup(0, 'tarok-20', 'An honor hidden below another card cannot be taken');
  await rejectPickup(0, 'tarok-1', 'An honor already in the private hand cannot be taken');
  assert.equal(clients[0].state.game.turn, 1);
  await pickup(0, 'tarok-22', 0, 'tarok-21');
  await rejectPickup(0, 'tarok-22', 'A repeated stale pickup cannot duplicate a card');
  await pickup(0, 'hearts-8', 1, 'hearts-1');
  await pickup(1, 'tarok-19', 0, 'tarok-18');

  await move(clients, 1, { type: 'play', cardId: clients[1].state.game.legalMoves[0] });
  assert.equal(clients[0].state.game.trick.length, 1);
  assert.equal(clients[0].state.game.turn, 0);
  await pickup(1, 'tarok-18', 0, 'diamonds-8');
  assert.equal(clients[1].state.game.pickups.length, 4,
    'A player may explicitly pick up while the opponent is replying to a trick');

  const beforeRestart = clients.map((current) => cloneForComparison(current.state.game));
  sockets.forEach((socket) => socket.disconnect());
  await server.close();
  server = await createTarokServer({ dataDir, engine: pickupFixtureEngine, logger: quietLogger });
  address = await server.listen(0, '127.0.0.1');
  clients = [await openClient(), await openClient()];
  assert.equal((await clients[0].request('room:resume', anaSession)).ok, true);
  assert.equal((await clients[1].request('room:resume', lukaSession)).ok, true);
  await clients[0].waitFor((state) => state?.players.every(({ connected }) => connected));
  assert.deepEqual(clients.map((current) => current.state.game), beforeRestart,
    'Restart restores both private hands, pickup options, public memory, and the incomplete trick');
  await rejectPickup(1, 'tarok-18', 'An already persisted pickup remains stale after restart');
  await pickup(0, 'tarok-21', 0, 'clubs-8');
});

const staleReplyFixtureEngine = {
  ...gameEngine,
  createGame(options) {
    const game = pickupFixtureEngine.createGame(options);
    game.phase = 'playing';
    game.announcementReady = [true, true];
    gameEngine.act(game, game.players[0].id, { type: 'pickup', cardId: 'tarok-22' });
    gameEngine.act(game, game.players[0].id, { type: 'pickup', cardId: 'tarok-21' });
    gameEngine.act(game, game.players[1].id, { type: 'play', cardId: 'tarok-16' });
    return game;
  },
};

test('play context rejects malformed and stale requests and prevents distinct-reply tab races', { timeout: 30_000 }, async (t) => {
  const room = await setupRoom(t, staleReplyFixtureEngine);
  const snapshotContext = playContext(room.clients[0].state.game);
  assert.deepEqual(snapshotContext, { round: 1, trickNumber: 1, trickSize: 1 });
  const contexts = [
    ['missing', undefined],
    ['null', null],
    ['empty', {}],
    ['array', [1, 1, 1]],
    ['string round', { ...snapshotContext, round: '1' }],
    ['zero round', { ...snapshotContext, round: 0 }],
    ['fractional trick number', { ...snapshotContext, trickNumber: 1.5 }],
    ['out-of-range trick number', { ...snapshotContext, trickNumber: 28 }],
    ['string trick size', { ...snapshotContext, trickSize: '1' }],
    ['invalid trick size', { ...snapshotContext, trickSize: 2 }],
    ['same trick before its lead', { ...snapshotContext, trickSize: 0 }],
    ['different trick', { ...snapshotContext, trickNumber: 2 }],
  ];
  for (const [description, expectedPlay] of contexts) {
    const counts = room.clients.map((current) => current.stateCount);
    const payload = { type: 'play', cardId: 'tarok-22' };
    if (expectedPlay !== undefined) payload.expectedPlay = expectedPlay;
    const response = await room.reject(0, payload, `Reject ${description} play context`);
    assert.equal(response.code, 'STALE_PLAY');
    if (description === 'missing') assert.match(response.error, /osveži/i, 'Old clients receive a refresh instruction');
    await Promise.all(room.clients.map((current, index) => current.waitFor(() => current.stateCount > counts[index])));
    assert.ok(!room.clients[1].state.game.hand.some((card) => ['tarok-21', 'tarok-22'].includes(card.id)),
      'Resynchronizing after rejection still keeps the other hand private');
  }

  const duplicate = await room.openTab(0);
  assert.deepEqual(duplicate.state.game.hand, room.clients[0].state.game.hand);
  assert.ok(room.clients[0].state.game.legalMoves.includes('tarok-21'));
  assert.ok(room.clients[0].state.game.legalMoves.includes('tarok-22'));
  const beforeHandCount = room.clients[0].state.game.hand.length;
  // Both tabs construct their distinct replies from the same displayed snapshot.
  // If the first reply wins, the second must not silently become the next lead.
  const results = await Promise.all([
    room.clients[0].request('game:action', { type: 'play', cardId: 'tarok-22', expectedPlay: snapshotContext }),
    duplicate.request('game:action', { type: 'play', cardId: 'tarok-21', expectedPlay: snapshotContext }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).code, 'STALE_PLAY');
  const allTabs = [...room.clients, duplicate];
  await Promise.all(allTabs.map((current) => current.waitFor((state) =>
    state?.game?.trickNumber === 2 && state.game.trick.length === 0)));
  const game = room.clients[0].state.game;
  assert.equal(game.hand.length, beforeHandCount - 1, 'Exactly one intended reply leaves the hand');
  assert.equal(game.turn, 0, 'The winner still needs to choose the next lead');
  assert.equal(game.players[0].trickCount, 1);
  assert.deepEqual(game.trick, []);
  assert.deepEqual(duplicate.state.game.hand, game.hand);
  const saved = JSON.parse(await readFile(room.roomFile, 'utf8'));
  assert.equal(saved.game.trickNumber, 2);
  assert.equal(saved.game.trick.length, 0, 'The save contains no accidental next-trick lead');
  assert.equal(saved.game.players[0].hand.length, beforeHandCount - 1);
  const remainingReply = ['tarok-21', 'tarok-22'].find((id) => game.hand.some((card) => card.id === id));
  assert.ok(game.legalMoves.includes(remainingReply), 'The rejected card is legal as a deliberately chosen new lead');
  const stale = await room.reject(0, {
    type: 'play', cardId: remainingReply, expectedPlay: snapshotContext,
  }, 'Replaying the old reply context cannot consume the next lead');
  assert.equal(stale.code, 'STALE_PLAY');
  await move(room.clients, 0, { type: 'play', cardId: remainingReply });
  assert.equal(room.clients[0].state.game.trick.length, 1, 'A fresh choice can lead the next trick normally');
});

test('still-current play contexts survive optional off-turn pickups and server restart', { timeout: 30_000 }, async (t) => {
  const room = await setupRoom(t, pickupFixtureEngine);
  await move(room.clients, 1, { type: 'bid', bid: 'play' });
  await confirmAnnouncements(room.clients);
  const leadContext = playContext(room.clients[1].state.game);
  assert.ok(room.clients[1].state.game.legalMoves.includes('tarok-16'));
  await move(room.clients, 0, { type: 'pickup', cardId: 'tarok-22' });
  assert.deepEqual(playContext(room.clients[1].state.game), leadContext);
  await move(room.clients, 1, { type: 'play', cardId: 'tarok-16', expectedPlay: leadContext });
  const replyContext = playContext(room.clients[0].state.game);
  assert.ok(room.clients[0].state.game.legalMoves.includes('tarok-22'));
  await move(room.clients, 1, { type: 'pickup', cardId: 'tarok-19' });
  assert.deepEqual(playContext(room.clients[0].state.game), replyContext);
  await room.restart();
  assert.deepEqual(playContext(room.clients[0].state.game), replyContext);
  await move(room.clients, 0, { type: 'play', cardId: 'tarok-22', expectedPlay: replyContext });
  assert.equal(room.clients[0].state.game.trickNumber, 2);
  assert.equal(room.clients[0].state.game.trick.length, 0);
});

test('unchanged play context still recalculates follow-suit legality after pickups', { timeout: 30_000 }, async (t) => {
  const room = await setupRoom(t, pickupFixtureEngine);
  await move(room.clients, 1, { type: 'bid', bid: 'play' });
  await confirmAnnouncements(room.clients);
  const clubLead = room.clients[1].state.game.hand.find((card) => card.suit === 'clubs').id;
  await move(room.clients, 1, { type: 'play', cardId: clubLead });
  const context = playContext(room.clients[0].state.game);
  assert.ok(room.clients[0].state.game.legalMoves.includes('tarok-1'), 'Without clubs exposed, replying with a trump is initially legal');
  await move(room.clients, 0, { type: 'pickup', cardId: 'tarok-22' });
  await move(room.clients, 0, { type: 'pickup', cardId: 'tarok-21' });
  assert.deepEqual(playContext(room.clients[0].state.game), context);
  assert.deepEqual(room.clients[0].state.game.legalMoves, ['clubs-8'], 'The newly exposed club king must now follow suit');
  const illegal = await room.reject(0, {
    type: 'play', cardId: 'tarok-1', expectedPlay: context,
  }, 'A context match must not bypass ordinary card legality');
  assert.notEqual(illegal.code, 'STALE_PLAY', 'The context remains current; the selected card is what became illegal');
  await move(room.clients, 0, { type: 'play', cardId: 'clubs-8', expectedPlay: context });
  assert.equal(room.clients[0].state.game.trickNumber, 2);
});
