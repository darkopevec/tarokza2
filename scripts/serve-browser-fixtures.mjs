// Local-only deterministic browser fixtures. Never included in the production
// Docker image; never reads or writes production rooms, or adds a seed API.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';

function createFixture(options) {
  const game = engine.createGame({ ...options, dealer: 1 });
  const deck = engine.createDeck();
  const byId = new Map(deck.map(card => [card.id, card]));
  const handIds = [
    'tarok-22', 'tarok-21', 'tarok-1',
    'clubs-8', 'spades-8', 'hearts-8', 'diamonds-8',
    ...Array.from({ length: 8 }, (_, index) => `tarok-${index + 2}`),
  ];
  const pileIds = [
    ['tarok-10', 'tarok-11', 'tarok-12', 'clubs-1'],
    ['tarok-13', 'tarok-14', 'tarok-15', 'spades-1'],
    ['tarok-16', 'tarok-17', 'tarok-18', 'hearts-1'],
  ];
  const used = new Set([...handIds, ...pileIds.flat()]);
  game.players[0].hand = handIds.map(id => byId.get(id));
  game.players[0].stacks = pileIds.map(pile => pile.map(id => byId.get(id)));
  const remaining = deck.filter(card => !used.has(card.id));
  game.players[1].hand = remaining.splice(0, 15);
  game.players[1].stacks = Array.from({ length: 3 }, () => remaining.splice(0, 4));
  const live = game.players.flatMap(player => [...player.hand, ...player.stacks.flat()]);
  assert.equal(live.length, 54);
  assert.equal(new Set(live.map(card => card.id)).size, 54);
  assert.equal(engine.countPoints(live), 70);
  assert.ok(game.players.every(player => player.hand.length === 15 && player.stacks.every(pile => pile.length === 4)));
  return game;
}

const fixturePort = Number(process.env.FIXTURE_PORT || 3001);
assert.ok(Number.isInteger(fixturePort) && fixturePort > 0 && fixturePort < 65536, 'Invalid fixture port.');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-browser-fixture-'));
const server = await createTarokServer({ dataDir, engine: { ...engine, createGame: createFixture } });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
}
try {
  await server.listen(fixturePort, '127.0.0.1');
  console.log(`Local test fixture only: http://127.0.0.1:${fixturePort}; disposable data ${dataDir}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }));
} catch (error) {
  await close();
  throw error;
}
