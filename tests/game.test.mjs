import test from 'node:test';
import assert from 'node:assert/strict';
import { act, countPoints, createDeck, createGame, exactPoints, legalMoves, legalPickups, legalAnnouncements, viewFor } from '../shared/game.mjs';
import { CARD_BY_ID, cardFor, createDeck as createCanonicalDeck } from '../shared/cards.mjs';

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
const makeGame = (seed = 42) => createGame({ playerIds: ['ana', 'bor'], names: ['Ana', 'Bor'], dealer: 0, rng: seeded(seed) });
const card = id => createDeck().find(item => item.id === id);
const takeTurn = (game, action) => act(game, game.players[game.turn].id, action);
const confirmBoth = game => {
  if (game.phase === 'announcements') {
    for (const player of game.players) act(game, player.id, { type: 'confirmAnnouncements' });
  }
};

function allLiveCards(game) {
  return [
    ...game.players.flatMap(player => [...player.hand, ...player.stacks.flat(), ...player.captured]),
    ...game.trick.map(play => play.card),
  ];
}

function assertConservation(game) {
  const cards = allLiveCards(game);
  assert.equal(cards.length, 54);
  assert.equal(new Set(cards.map(item => item.id)).size, 54);
  assert.equal(countPoints(cards), 70);
}

function playToEnd(game, rng = seeded(10), usePickups = true) {
  confirmBoth(game);
  while (game.phase === 'playing') {
    if (usePickups) {
      for (const player of game.players) {
        const choices = legalPickups(game, player.id);
        if (choices.length && rng() < 0.4) {
          const turn = game.turn;
          act(game, player.id, { type: 'pickup', cardId: choices[Math.floor(rng() * choices.length)] });
          assert.equal(game.turn, turn);
          assertConservation(game);
        }
      }
    }
    const moves = legalMoves(game, game.players[game.turn].id);
    assert.ok(moves.length > 0, 'every active turn has a legal move');
    takeTurn(game, { type: 'play', cardId: moves[Math.floor(rng() * moves.length)] });
    assertConservation(game);
  }
}

test('the 54-card deck has correct strengths, honors and 70 points', () => {
  const deck = createDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map(item => item.id)).size, 54);
  assert.equal(deck.filter(item => item.suit === 'tarok').length, 22);
  assert.equal(countPoints(deck), 70);
  assert.equal(exactPoints(deck), 70);
  assert.equal(card('hearts-4').label, '1');
  assert.equal(card('hearts-4').name, 'Enka srca');
  assert.equal(card('diamonds-4').name, 'Enka kare');
  assert.equal(card('hearts-1').label, '4');
  assert.equal(card('spades-4').label, '10');
  assert.equal(card('clubs-1').label, '7');
  assert.equal(card('tarok-22').points, 5);
  assert.equal(card('hearts-8').points, 5);
  assert.equal(card('hearts-7').points, 4);
  assert.equal(card('hearts-6').points, 3);
  assert.equal(card('hearts-5').points, 2);
});

test('the shared catalogue names all court cards clearly and maps every card to its own image', () => {
  const deck = createCanonicalDeck();
  assert.deepEqual(deck, createDeck());
  assert.equal(Object.keys(CARD_BY_ID).length, 54);
  for (const suit of ['clubs', 'spades', 'hearts', 'diamonds']) {
    assert.deepEqual(deck.filter(item => item.suit === suit).map(item => item.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(deck.filter(item => item.suit === suit && item.rank > 4).map(item => item.label), ['Fant', 'Kaval', 'Dama', 'Kralj']);
  }
  for (const item of deck) {
    assert.equal(item.image, `/cards/deck/${item.id}.jpg`);
    assert.ok(!['A', 'F', 'C', 'D', 'K'].includes(item.label));
    assert.deepEqual(cardFor(item.id), item);
  }
  assert.equal(cardFor('unknown'), null);
  assert.equal(cardFor('toString'), null);
  deck[0].label = 'changed';
  assert.equal(cardFor('tarok-1').label, 'I');
  assert.equal(createCanonicalDeck()[0].label, 'I');
});

test('counting uses complete triples and handles the final one or two cards', () => {
  assert.equal(countPoints([]), 0);
  assert.equal(countPoints([card('tarok-2')]), 0);
  assert.equal(countPoints([card('tarok-1')]), 4);
  assert.equal(countPoints([card('clubs-6'), card('clubs-5')]), 4);
  assert.equal(countPoints([card('clubs-8'), card('clubs-7'), card('clubs-1')]), 8);
  assert.equal(exactPoints([card('tarok-2'), card('tarok-3')]), 2 / 3);
});

test('dealing gives each player 15 hand cards and three closed four-card piles', () => {
  const game = makeGame();
  assert.equal(game.phase, 'bidding');
  assert.equal(game.turn, 1);
  for (const player of game.players) {
    assert.equal(player.hand.length, 15);
    assert.deepEqual(player.stacks.map(stack => stack.length), [4, 4, 4]);
  }
  const view = viewFor(game, 'bor');
  assert.equal(view.hand.length, 15);
  assert.ok(view.players.every(player => player.stacks.every(stack => stack.top === null)));
  assert.deepEqual(view.pickups, []);
  assert.deepEqual(view.legalPickups, []);
  assert.deepEqual(view.legalBids, ['play', 'pass']);
  assert.deepEqual(viewFor(game, 'ana').legalBids, []);
  assertConservation(game);
});

test('the non-dealer bids first and also leads if the dealer takes the contract', () => {
  const game = makeGame();
  takeTurn(game, { type: 'bid', bid: 'pass' });
  assert.equal(game.turn, 0);
  assert.equal(game.phase, 'bidding');
  takeTurn(game, { type: 'bid', bid: 'play' });
  assert.equal(game.phase, 'announcements');
  assert.equal(game.contract.player, 0);
  assert.equal(game.turn, 1);
  assert.equal(game.bids.length, 2);
  confirmBoth(game);
  assert.equal(game.phase, 'playing');
  assert.equal(game.turn, 1);
});

test('two passes start an ordinary game, without klop or redealing', () => {
  const game = makeGame();
  takeTurn(game, { type: 'bid', bid: 'pass' });
  takeTurn(game, { type: 'bid', bid: 'pass' });
  assert.equal(game.phase, 'announcements');
  assert.deepEqual(game.contract, { player: null, kind: 'normal' });
  assert.equal(game.turn, 1);
  assert.equal(game.round, 1);
  assertConservation(game);
});

test('bidding reveals pile tops but never transfers exposed honors automatically', () => {
  const game = makeGame();
  game.players[0].stacks = [[card('tarok-4'), card('hearts-8'), card('tarok-22'), card('clubs-3')], [], []];
  game.players[0].hand = [];
  assert.deepEqual(legalPickups(game, 'ana'), []);
  takeTurn(game, { type: 'bid', bid: 'play' });
  assert.deepEqual(game.players[0].hand, []);
  assert.equal(game.players[0].stacks[0].length, 4);
  assert.equal(viewFor(game, 'bor').players[0].stacks[0].top.id, 'tarok-4');
  assert.deepEqual(legalPickups(game, 'ana'), ['tarok-4']);
  assert.deepEqual(game.pickups, []);
});

test('each manual pickup transfers exactly one honor and preserves play state, including off turn', () => {
  const game = scenario({ hand: [], stacks: [['tarok-4', 'hearts-8', 'tarok-22', 'clubs-3']] });
  game.turn = 1;
  const playState = () => JSON.stringify({ turn: game.turn, phase: game.phase, trick: game.trick, lastTrick: game.lastTrick, number: game.trickNumber, scoreboard: game.scoreboard });
  const before = playState();
  for (const [index, id] of ['tarok-4', 'hearts-8', 'tarok-22'].entries()) {
    assert.deepEqual(viewFor(game, 'ana').legalPickups, [id]);
    act(game, 'ana', { type: 'pickup', cardId: id });
    assert.equal(game.players[0].hand.length, index + 1);
    assert.equal(game.players[0].stacks[0].length, 3 - index);
    assert.equal(game.pickups.length, index + 1);
    assert.equal(playState(), before);
  }
  assert.deepEqual(new Set(game.players[0].hand.map(item => item.id)), new Set(['tarok-4', 'hearts-8', 'tarok-22']));
  assert.deepEqual(game.players[0].hand.map(item => item.id), ['tarok-22', 'tarok-4', 'hearts-8']);
  assert.deepEqual(game.players[0].stacks[0].map(item => item.id), ['clubs-3']);
  assert.deepEqual(legalPickups(game, 'ana'), []);
  assert.deepEqual(game.pickups.filter(pickup => pickup.player === 0), [
    { player: 0, card: card('tarok-4'), stack: 0, trickNumber: 1 },
    { player: 0, card: card('hearts-8'), stack: 0, trickNumber: 1 },
    { player: 0, card: card('tarok-22'), stack: 0, trickNumber: 1 },
  ]);
  assert.deepEqual(viewFor(game, 'bor').pickups, game.pickups);
});

function scenario({ hand, stacks = [], lead = null }) {
  const game = makeGame();
  takeTurn(game, { type: 'bid', bid: 'play' });
  confirmBoth(game);
  game.turn = 0;
  game.players[0].hand = hand.map(card);
  game.players[0].stacks = [...stacks.map(stack => stack.map(card)), [], []].slice(0, 3);
  game.trick = lead ? [{ player: 1, card: card(lead) }] : [];
  return game;
}

test('pile cards may follow but cannot lead while any hand card remains', () => {
  const game = scenario({ hand: ['hearts-4'], stacks: [['clubs-7']] });
  assert.deepEqual(legalMoves(game, 'ana'), ['hearts-4']);
  assert.throws(() => act(game, 'ana', { type: 'play', cardId: 'clubs-7' }));
  game.players[0].hand = [];
  assert.deepEqual(legalMoves(game, 'ana'), ['clubs-7']);
});

test('an exposed pile card must follow suit before a trump held in hand', () => {
  const game = scenario({ hand: ['tarok-22', 'hearts-4'], stacks: [['clubs-7', 'spades-2']], lead: 'clubs-2' });
  assert.deepEqual(legalMoves(game, 'ana'), ['clubs-7']);
  const before = JSON.stringify(game);
  assert.throws(() => act(game, 'ana', { type: 'play', cardId: 'tarok-22' }));
  assert.equal(JSON.stringify(game), before, 'rejected actions leave state intact');
});

test('following suit and trumping are mandatory, overtaking is not', () => {
  assert.deepEqual(legalMoves(scenario({ hand: ['clubs-1', 'clubs-8', 'tarok-22'], lead: 'clubs-7' }), 'ana'), ['clubs-1', 'clubs-8']);
  assert.deepEqual(legalMoves(scenario({ hand: ['hearts-4', 'tarok-2', 'tarok-22'], lead: 'clubs-7' }), 'ana'), ['tarok-2', 'tarok-22']);
  assert.deepEqual(legalMoves(scenario({ hand: ['hearts-4', 'tarok-1', 'tarok-22'], lead: 'tarok-20' }), 'ana'), ['tarok-1', 'tarok-22']);
  assert.deepEqual(legalMoves(scenario({ hand: ['hearts-4', 'spades-2'], lead: 'clubs-7' }), 'ana'), ['hearts-4', 'spades-2']);
});

test('using a pile exposes its next honor without picking it up or revealing the following card', () => {
  const game = scenario({ hand: ['hearts-4'], stacks: [['clubs-7', 'tarok-22', 'spades-8', 'diamonds-1']], lead: 'clubs-2' });
  act(game, 'ana', { type: 'play', cardId: 'clubs-7' });
  assert.equal(game.lastTrick.winner, 0);
  assert.deepEqual(game.players[0].stacks[0].map(item => item.id), ['tarok-22', 'spades-8', 'diamonds-1']);
  assert.deepEqual(game.players[0].hand.map(item => item.id), ['hearts-4']);
  assert.deepEqual(game.pickups, []);
  assert.deepEqual(legalPickups(game, 'ana'), ['tarok-22']);
});

test('players can decline pickups and use an exposed honor directly to follow', () => {
  for (const [top, lead] of [['tarok-22', 'clubs-2'], ['clubs-8', 'clubs-2']]) {
    const game = scenario({ hand: ['hearts-4'], stacks: [[top, 'diamonds-1']], lead });
    assert.deepEqual(legalMoves(game, 'ana'), [top]);
    act(game, 'ana', { type: 'play', cardId: top });
    assert.equal(game.lastTrick.winner, 0);
    assert.deepEqual(game.pickups, []);
    assert.deepEqual(game.players[0].hand.map(item => item.id), ['hearts-4']);
  }
});

test('leaving an honor on the pile keeps it available for a later off-turn pickup', () => {
  const game = scenario({ hand: ['hearts-4', 'clubs-1'], stacks: [['tarok-22', 'diamonds-1']] });
  game.players[1].hand = [card('hearts-5'), card('clubs-7')];
  game.players[1].stacks = [[], [], []];
  assert.deepEqual(legalPickups(game, 'ana'), ['tarok-22']);
  act(game, 'ana', { type: 'play', cardId: 'hearts-4' });
  act(game, 'bor', { type: 'play', cardId: 'hearts-5' });
  assert.equal(game.turn, 1);
  assert.equal(game.trickNumber, 2);
  assert.deepEqual(legalPickups(game, 'ana'), ['tarok-22']);
  const before = JSON.stringify({ trick: game.trick, lastTrick: game.lastTrick });
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  assert.equal(game.turn, 1);
  assert.equal(game.trickNumber, 2);
  assert.equal(JSON.stringify({ trick: game.trick, lastTrick: game.lastTrick }), before);
  assert.equal(game.pickups[0].trickNumber, 2);
});

test('a pickup recomputes following suit and the hand-only leading restriction', () => {
  const reply = scenario({ hand: ['hearts-4'], stacks: [['tarok-22', 'clubs-5']], lead: 'clubs-2' });
  assert.deepEqual(legalMoves(reply, 'ana'), ['tarok-22']);
  const trick = structuredClone(reply.trick);
  act(reply, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  assert.deepEqual(reply.trick, trick);
  assert.deepEqual(legalMoves(reply, 'ana'), ['clubs-5']);
  assert.throws(() => act(reply, 'ana', { type: 'play', cardId: 'tarok-22' }));
  const lead = scenario({ hand: [], stacks: [['tarok-22'], ['clubs-7']] });
  assert.deepEqual(legalMoves(lead, 'ana'), ['tarok-22', 'clubs-7']);
  act(lead, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  assert.deepEqual(legalMoves(lead, 'ana'), ['tarok-22']);
  assert.throws(() => act(lead, 'ana', { type: 'play', cardId: 'clubs-7' }));
});

test('invalid, stale, foreign, hidden and nonhonor pickups are rejected without mutation', () => {
  const game = scenario({ hand: ['tarok-20'], stacks: [['tarok-22', 'spades-8'], ['clubs-7']] });
  game.players[1].hand = [];
  game.players[1].stacks = [[card('tarok-21')], [], []];
  for (const [id, cardId] of [
    ['stranger', 'tarok-22'], ['ana', 'unknown'], ['ana', 'tarok-21'],
    ['ana', 'spades-8'], ['ana', 'clubs-7'], ['ana', 'tarok-20'], ['bor', 'tarok-22'],
  ]) {
    const before = JSON.stringify(game);
    assert.throws(() => act(game, id, { type: 'pickup', cardId }));
    assert.equal(JSON.stringify(game), before);
  }
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  const after = JSON.stringify(game);
  assert.throws(() => act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' }));
  assert.equal(JSON.stringify(game), after);
  for (const phase of ['bidding', 'roundEnd']) {
    game.phase = phase;
    const before = JSON.stringify(game);
    assert.deepEqual(legalPickups(game, 'ana'), []);
    assert.throws(() => act(game, 'ana', { type: 'pickup', cardId: 'spades-8' }));
    assert.equal(JSON.stringify(game), before);
  }
});

test('pickup options remain private while chosen cards and the next exposed top become public', () => {
  const game = scenario({ hand: ['hearts-4'], stacks: [['tarok-22', 'spades-8', 'clubs-7']] });
  game.players[1].hand = [card('diamonds-4')];
  game.players[1].stacks = [[card('tarok-21')], [], []];
  assert.deepEqual(viewFor(game, 'ana').legalPickups, ['tarok-22']);
  assert.deepEqual(viewFor(game, 'bor').legalPickups, ['tarok-21']);
  assert.ok(!JSON.stringify(viewFor(game, 'bor')).includes('spades-8'));
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  const opponent = viewFor(game, 'bor');
  assert.equal(opponent.players[0].handCount, 2);
  assert.equal(opponent.players[0].stacks[0].top.id, 'spades-8');
  assert.equal(opponent.pickups[0].card.id, 'tarok-22');
  assert.ok(!JSON.stringify(opponent).includes('hearts-4'));
  assert.ok(!JSON.stringify(opponent).includes('clubs-7'));
  assert.ok(opponent.hand.every(item => item.id !== 'tarok-22'));
});

test('trump wins over a suit and an off-suit discard cannot win', () => {
  for (const [lead, reply, winner] of [
    ['hearts-8', 'tarok-1', 0], ['tarok-22', 'tarok-21', 1],
    ['clubs-1', 'hearts-8', 1], ['hearts-1', 'hearts-4', 0],
  ]) {
    const game = scenario({ hand: [reply], lead });
    act(game, 'ana', { type: 'play', cardId: reply });
    assert.equal(game.lastTrick.winner, winner);
    assert.equal(game.turn, winner);
  }
});

test('invalid identities, wrong turns, early readiness and invalid bids are rejected', () => {
  const game = makeGame();
  const before = JSON.stringify(game);
  assert.throws(() => act(game, 'stranger', { type: 'bid', bid: 'play' }));
  assert.throws(() => viewFor(game, 'stranger'));
  assert.throws(() => act(game, 'ana', { type: 'bid', bid: 'play' }));
  assert.throws(() => act(game, 'bor', { type: 'bid', bid: 'valat' }));
  assert.throws(() => act(game, 'bor', { type: 'ready' }));
  assert.throws(() => act(game, 'bor', { type: 'play', cardId: game.players[1].hand[0].id }));
  assert.equal(JSON.stringify(game), before);
});

test('views never contain secret opponent hand cards or cards below exposed stack tops', () => {
  const game = makeGame();
  for (const phase of ['bidding', 'playing']) {
    if (phase === 'playing') {
      takeTurn(game, { type: 'bid', bid: 'play' });
      confirmBoth(game);
    }
    for (const [seat, id] of [[0, 'ana'], [1, 'bor']]) {
      const view = viewFor(game, id);
      const payload = JSON.stringify(view);
      const publicPickups = new Set(game.pickups.map(pickup => pickup.card.id));
      const hidden = [
        ...game.players[1 - seat].hand.filter(item => !publicPickups.has(item.id)),
        ...game.players.flatMap(player => player.stacks.flatMap(stack => phase === 'bidding' ? stack : stack.slice(1))),
      ];
      for (const item of hidden) assert.ok(!payload.includes(`"${item.id}"`), `${phase}: leaked ${item.id}`);
      assert.ok(view.players.every(player => !('hand' in player) && !('captured' in player)));
      view.hand[0].points = 1000;
      assert.ok(game.players[seat].hand.every(item => item.points <= 5), 'view cannot mutate engine state');
    }
  }
});

test('hundreds of randomized rounds conserve cards, finish exactly 27 tricks and score contracts', () => {
  let wins = 0;
  let losses = 0;
  let normal = 0;
  let manualPickups = 0;
  let declarations = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const game = makeGame(seed);
    const rng = seeded(seed * 97);
    if (seed % 3 === 0) {
      takeTurn(game, { type: 'bid', bid: 'pass' });
      takeTurn(game, { type: 'bid', bid: 'pass' });
      normal++;
    } else {
      if (seed % 3 === 1) takeTurn(game, { type: 'bid', bid: 'pass' });
      takeTurn(game, { type: 'bid', bid: 'play' });
    }
    for (const player of game.players) {
      if (seed % 5 !== 0) {
        let choices = legalPickups(game, player.id);
        while (choices.length && rng() < 0.6) {
          act(game, player.id, { type: 'pickup', cardId: choices[Math.floor(rng() * choices.length)] });
          assertConservation(game);
          choices = legalPickups(game, player.id);
        }
      }
      for (const bonus of legalAnnouncements(game, player.id)) {
        if (rng() < 0.5) {
          act(game, player.id, { type: 'announce', bonus });
          declarations++;
        }
      }
      act(game, player.id, { type: 'confirmAnnouncements' });
    }
    playToEnd(game, rng, seed % 5 !== 0);
    assert.equal(game.phase, 'roundEnd');
    assert.equal(game.trickNumber, 27);
    assert.equal(game.lastTrick.number, 27);
    assert.equal(game.players.reduce((sum, player) => sum + player.trickCount, 0), 27);
    assert.equal(game.players.flatMap(player => player.hand).length, 0);
    assert.equal(game.players.flatMap(player => player.stacks.flat()).length, 0);
    assert.ok(game.pickups.length <= 24);
    if (seed % 5 === 0) assert.equal(game.pickups.length, 0, 'a round may finish with every pickup declined');
    manualPickups += game.pickups.length;
    assert.equal(new Set(game.pickups.map(pickup => pickup.card.id)).size, game.pickups.length);
    assert.ok(game.pickups.every(pickup => pickup.card.suit === 'tarok' || pickup.card.rank === 8));
    const row = game.scoreboard[0];
    assert.equal(row.points[0] + row.points[1], 70);
    assert.ok(Math.abs(row.exactPoints[0] + row.exactPoints[1] - 70) < 1e-10);
    if (row.contract.kind === 'announced') {
      const bidder = row.contract.player;
      if (row.contractWon) wins++; else losses++;
      const gamePoints = row.breakdown.find(entry => entry.kind === 'game' && entry.player === bidder);
      if (gamePoints) assert.equal(gamePoints.points, (row.points[bidder] - 35) * (row.contractWon ? 2 : 3));
    } else if (row.winner !== null) {
      const gamePoints = row.breakdown.find(entry => entry.kind === 'game' && entry.player === row.winner);
      if (gamePoints) assert.equal(gamePoints.points, row.points[row.winner] - 35);
    }
    assert.equal(row.scoringVersion, 2);
    assert.deepEqual(row.deltas, [0, 1].map(player => row.breakdown.filter(entry => entry.player === player).reduce((sum, entry) => sum + entry.points, 0)));
    assert.deepEqual(row.totals, game.players.map(player => player.score));
  }
  assert.ok(wins > 0 && losses > 0 && normal > 0);
  assert.ok(manualPickups > 0);
  assert.ok(declarations > 0);
});

test('both players must be ready; next round rotates dealer and retains complete scoreboard', () => {
  const game = makeGame();
  takeTurn(game, { type: 'bid', bid: 'play' });
  playToEnd(game);
  const row = structuredClone(game.scoreboard[0]);
  act(game, 'ana', { type: 'ready' });
  act(game, 'ana', { type: 'ready' });
  assert.equal(game.phase, 'roundEnd');
  assert.equal(game.round, 1);
  assert.deepEqual(viewFor(game, 'bor').ready, [true, false]);
  act(game, 'bor', { type: 'ready' });
  assert.equal(game.phase, 'bidding');
  assert.equal(game.round, 2);
  assert.equal(game.dealer, 1);
  assert.equal(game.turn, 0);
  assert.deepEqual(viewFor(game, 'ana').ready, [false, false]);
  assert.deepEqual(viewFor(game, 'ana').pickups, []);
  assert.deepEqual(game.scoreboard, [row]);
  assert.deepEqual(game.players.map(player => player.score), row.totals);
  assertConservation(game);
  takeTurn(game, { type: 'bid', bid: 'pass' });
  takeTurn(game, { type: 'bid', bid: 'pass' });
  playToEnd(game);
  assert.equal(game.scoreboard.length, 2);
  assert.deepEqual(game.scoreboard[0], row);
  assert.deepEqual(game.scoreboard[1].totals, row.totals.map((score, seat) => score + game.scoreboard[1].deltas[seat]));
});

test('JSON persistence can resume bidding, an incomplete trick, scoring and a new round', () => {
  let game = JSON.parse(JSON.stringify(makeGame()));
  takeTurn(game, { type: 'bid', bid: 'play' });
  const picker = game.players.find(player => legalPickups(game, player.id).length);
  assert.ok(picker);
  act(game, picker.id, { type: 'pickup', cardId: legalPickups(game, picker.id)[0] });
  confirmBoth(game);
  takeTurn(game, { type: 'play', cardId: legalMoves(game, game.players[game.turn].id)[0] });
  const pickups = structuredClone(game.pickups);
  game = JSON.parse(JSON.stringify(game));
  assert.deepEqual(viewFor(game, 'ana').pickups, pickups);
  assert.equal(game.trick.length, 1);
  playToEnd(game);
  game = JSON.parse(JSON.stringify(game));
  act(game, 'ana', { type: 'ready' });
  act(game, 'bor', { type: 'ready' });
  assert.equal(game.round, 2);
  assertConservation(game);
});

test('pickup memory survives playing its card and old saved games remain compatible', () => {
  const game = scenario({ hand: ['tarok-22'], lead: 'tarok-2' });
  game.pickups = [{ player: 0, card: card('tarok-22'), stack: 2, trickNumber: 1 }];
  act(game, 'ana', { type: 'play', cardId: 'tarok-22' });
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(viewFor(game, 'bor').pickups[0].card.id, 'tarok-22');
  const legacy = makeGame();
  delete legacy.pickups;
  assert.deepEqual(viewFor(legacy, 'ana').pickups, []);
  takeTurn(legacy, { type: 'bid', bid: 'play' });
  const picker = legacy.players.find(player => legalPickups(legacy, player.id).length);
  const previousHand = structuredClone(picker.hand);
  const pickupId = legalPickups(legacy, picker.id)[0];
  act(legacy, picker.id, { type: 'pickup', cardId: pickupId });
  assert.ok(previousHand.every(item => picker.hand.some(held => held.id === item.id)));
  assert.equal(legacy.pickups[0].card.id, pickupId);
  playToEnd(legacy);
  assert.ok(Array.isArray(legacy.pickups));
});

function legacyCard(id) {
  const result = { ...cardFor(id) };
  if (result.suit !== 'tarok') {
    if (result.rank > 4) result.label = ['F', 'C', 'D', 'K'][result.rank - 5];
    else if (['hearts', 'diamonds'].includes(result.suit) && result.rank === 4) result.label = 'A';
  }
  result.name = `${result.label} (staro ime)`;
  delete result.image;
  return result;
}

test('all public card locations normalize older saved labels without changing the game', () => {
  const game = makeGame();
  game.phase = 'playing';
  game.players[0].hand = [legacyCard('hearts-4'), legacyCard('clubs-5')];
  game.players[0].stacks = [[legacyCard('diamonds-6')], [], []];
  game.players[1].stacks = [[legacyCard('spades-7')], [], []];
  game.trick = [{ player: 1, card: legacyCard('spades-6') }];
  game.lastTrick = { winner: 0, number: 1, cards: [{ player: 0, card: legacyCard('clubs-8') }, { player: 1, card: legacyCard('clubs-7') }] };
  game.pickups = [{ player: 1, card: legacyCard('diamonds-8'), stack: 1, trickNumber: 1 }];
  const before = JSON.stringify(game);
  const view = viewFor(game, 'ana');
  const visible = [
    ...view.hand, ...view.players.flatMap(player => player.stacks.map(stack => stack.top).filter(Boolean)),
    ...view.trick.map(play => play.card), ...view.lastTrick.cards.map(play => play.card), ...view.pickups.map(pickup => pickup.card),
  ];
  assert.equal(visible.length, 8);
  for (const item of visible) assert.deepEqual(item, cardFor(item.id));
  assert.equal(JSON.stringify(game), before, 'view normalization must not modify a saved game');
});

test('a full legacy round preserves the same moves, points and score as canonical metadata', () => {
  const current = makeGame();
  const legacy = JSON.parse(JSON.stringify(current));
  for (const player of legacy.players) {
    player.hand = player.hand.map(item => legacyCard(item.id));
    player.stacks = player.stacks.map(stack => stack.map(item => legacyCard(item.id)));
  }
  for (const game of [current, legacy]) {
    takeTurn(game, { type: 'bid', bid: 'play' });
    confirmBoth(game);
  }
  while (current.phase === 'playing') {
    const id = current.players[current.turn].id;
    const moves = legalMoves(current, id);
    assert.deepEqual(legalMoves(legacy, id), moves);
    for (const game of [current, legacy]) act(game, id, { type: 'play', cardId: moves[0] });
    assertConservation(legacy);
  }
  assert.deepEqual(legacy.scoreboard, current.scoreboard);
  assert.deepEqual(viewFor(legacy, 'ana'), viewFor(current, 'ana'));
  act(legacy, 'ana', { type: 'ready' });
  act(legacy, 'bor', { type: 'ready' });
  assert.equal(legacy.round, 2);
  assertConservation(legacy);
  assert.ok(legacy.players.flatMap(player => player.hand).every(item => item.image));
});

const kings = ['clubs-8', 'spades-8', 'hearts-8', 'diamonds-8'];
const trula = ['tarok-1', 'tarok-21', 'tarok-22'];

function announcementGame() {
  const game = makeGame();
  takeTurn(game, { type: 'bid', bid: 'play' });
  return game;
}

test('new deals require both announcement confirmations before any card play', () => {
  const game = announcementGame();
  assert.equal(game.scoringVersion, 2);
  assert.equal(game.phase, 'announcements');
  assert.deepEqual(game.announcementReady, [false, false]);
  const before = JSON.stringify(game);
  assert.deepEqual(legalMoves(game, 'bor'), []);
  assert.throws(() => takeTurn(game, { type: 'play', cardId: game.players[1].hand[0].id }));
  assert.equal(JSON.stringify(game), before);
  act(game, 'bor', { type: 'confirmAnnouncements' });
  act(game, 'bor', { type: 'confirmAnnouncements' });
  assert.equal(game.phase, 'announcements');
  assert.deepEqual(game.announcementReady, [false, true]);
  act(game, 'ana', { type: 'confirmAnnouncements' });
  assert.equal(game.phase, 'playing');
  assert.equal(game.turn, 1);
  const started = JSON.stringify(game);
  assert.throws(() => act(game, 'ana', { type: 'confirmAnnouncements' }));
  assert.equal(JSON.stringify(game), started);
});

test('king and trula declarations require the full set in hand, including manually picked cards', () => {
  const game = announcementGame();
  game.players[0].hand = [...kings.slice(0, 3), ...trula.slice(0, 2)].map(card);
  game.players[0].stacks = [[card('diamonds-8'), card('tarok-22'), card('clubs-1')], [], []];
  assert.deepEqual(legalAnnouncements(game, 'ana'), []);
  const before = JSON.stringify(game);
  for (const bonus of ['kings', 'trula', 'unknown']) assert.throws(() => act(game, 'ana', { type: 'announce', bonus }));
  assert.equal(JSON.stringify(game), before);
  act(game, 'ana', { type: 'pickup', cardId: 'diamonds-8' });
  assert.deepEqual(legalAnnouncements(game, 'ana'), ['kings']);
  act(game, 'ana', { type: 'announce', bonus: 'kings' });
  assert.deepEqual(legalAnnouncements(game, 'ana'), []);
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  assert.deepEqual(legalAnnouncements(game, 'ana'), ['trula', 'valat']);
  act(game, 'ana', { type: 'announce', bonus: 'trula' });
  assert.deepEqual(game.announcements, [{ player: 0, bonus: 'kings' }, { player: 0, bonus: 'trula' }]);
  const called = JSON.stringify(game);
  assert.throws(() => act(game, 'ana', { type: 'announce', bonus: 'kings' }));
  assert.equal(JSON.stringify(game), called);
});

test('valat requires no hidden own pile cards, allows face-up cards, and never depends on opponent ordering', () => {
  const game = announcementGame();
  game.players[0].stacks = [[card('tarok-2'), card('tarok-3')], [], [card('clubs-1')]];
  game.players[1].stacks = [[card('hearts-1')], [card('diamonds-1')], []];
  assert.ok(!legalAnnouncements(game, 'ana').includes('valat'));
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-2' });
  assert.deepEqual(game.players[0].stacks.map(stack => stack.length), [1, 0, 1]);
  assert.ok(legalAnnouncements(game, 'ana').includes('valat'));
  act(game, 'bor', { type: 'announce', bonus: 'valat' });
  assert.ok(legalAnnouncements(game, 'ana').includes('valat'));
  act(game, 'ana', { type: 'announce', bonus: 'valat' });
  assert.ok(!legalAnnouncements(game, 'ana').includes('valat'));
  assert.deepEqual(game.announcements, [{ player: 1, bonus: 'valat' }, { player: 0, bonus: 'valat' }]);
});

test('confirmation freezes only that player until play begins; declarations stay public and eligibility private', () => {
  const game = announcementGame();
  game.players[0].hand = kings.map(card);
  game.players[0].stacks = [[card('tarok-22'), card('hearts-1')], [], []];
  game.players[1].hand = [card('clubs-1')];
  game.players[1].stacks = [[card('tarok-21'), card('diamonds-1')], [], []];
  assert.deepEqual(viewFor(game, 'ana').legalAnnouncements, ['kings']);
  assert.deepEqual(viewFor(game, 'bor').legalAnnouncements, []);
  assert.ok(!JSON.stringify(viewFor(game, 'bor')).includes('clubs-8'));
  act(game, 'ana', { type: 'announce', bonus: 'kings' });
  assert.deepEqual(viewFor(game, 'bor').announcements, [{ player: 0, bonus: 'kings' }]);
  assert.ok(!JSON.stringify(viewFor(game, 'bor')).includes('clubs-8'), 'a call must not expose hand descriptors');
  act(game, 'ana', { type: 'confirmAnnouncements' });
  assert.deepEqual(legalPickups(game, 'ana'), []);
  assert.deepEqual(legalAnnouncements(game, 'ana'), []);
  const frozen = JSON.stringify(game);
  assert.throws(() => act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' }));
  assert.throws(() => act(game, 'ana', { type: 'announce', bonus: 'valat' }));
  assert.equal(JSON.stringify(game), frozen);
  act(game, 'bor', { type: 'pickup', cardId: 'tarok-21' });
  act(game, 'bor', { type: 'confirmAnnouncements' });
  assert.equal(game.phase, 'playing');
  assert.deepEqual(legalPickups(game, 'ana'), ['tarok-22']);
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  assert.equal(game.turn, 1);
  assert.deepEqual(legalAnnouncements(game, 'ana'), []);
});

// A complete legal last-trick position: 52 unique cards already captured and
// exactly one card in each hand. Scoring fixtures need no artificial score API.
function finishPosition({ required0 = [], excluded0 = [], count0 = 26, last = ['clubs-1', 'clubs-2'], announcements = [], legacy = false } = {}) {
  const game = makeGame();
  const available = createDeck().filter(item => !last.includes(item.id));
  const heldBy0 = new Set(required0);
  for (const item of available) {
    if (heldBy0.size < count0 && !excluded0.includes(item.id)) heldBy0.add(item.id);
  }
  assert.equal(heldBy0.size, count0);
  game.players.forEach((player, seat) => {
    player.hand = [card(last[seat])];
    player.stacks = [[], [], []];
    player.captured = available.filter(item => heldBy0.has(item.id) === (seat === 0));
    player.trickCount = player.captured.length / 2;
  });
  game.phase = 'playing';
  game.turn = 0;
  game.trickNumber = 27;
  game.announcements = structuredClone(announcements);
  if (legacy) delete game.scoringVersion;
  assertConservation(game);
  act(game, 'ana', { type: 'play', cardId: last[0] });
  act(game, 'bor', { type: 'play', cardId: last[1] });
  assert.equal(game.phase, 'roundEnd');
  assertConservation(game);
  return game;
}

test('silent kings and trula each award exactly 10 to their collector', () => {
  const game = finishPosition({ required0: [...kings, ...trula] });
  const row = game.scoreboard[0];
  assert.deepEqual(row.breakdown.filter(entry => entry.kind !== 'game'), [
    { player: 0, kind: 'kings', points: 10, announced: false, success: true },
    { player: 0, kind: 'trula', points: 10, announced: false, success: true },
  ]);
});

test('announced sets settle from captured cards: +20 when made, -20 when failed, plus independent opposing silent sets', () => {
  const calls = [{ player: 0, bonus: 'kings' }, { player: 0, bonus: 'trula' }];
  const won = finishPosition({ required0: [...kings, ...trula], announcements: calls }).scoreboard[0];
  assert.deepEqual(won.breakdown.filter(entry => entry.kind !== 'game'), [
    { player: 0, kind: 'kings', points: 20, announced: true, success: true },
    { player: 0, kind: 'trula', points: 20, announced: true, success: true },
  ]);
  const lost = finishPosition({ excluded0: [...kings, ...trula], announcements: calls }).scoreboard[0];
  assert.deepEqual(lost.breakdown.filter(entry => entry.kind !== 'game'), [
    { player: 0, kind: 'kings', points: -20, announced: true, success: false },
    { player: 0, kind: 'trula', points: -20, announced: true, success: false },
    { player: 1, kind: 'kings', points: 10, announced: false, success: true },
    { player: 1, kind: 'trula', points: 10, announced: false, success: true },
  ]);
});

test('silent valat awards 250 and replaces game, kings and trula for both players', () => {
  const game = finishPosition({ count0: 52, last: ['clubs-2', 'clubs-1'], announcements: [{ player: 0, bonus: 'kings' }, { player: 1, bonus: 'trula' }] });
  assert.deepEqual(game.scoreboard[0].breakdown, [{ player: 0, kind: 'valat', points: 250, announced: false, success: true }]);
  assert.deepEqual(game.scoreboard[0].deltas, [250, 0]);
});

test('announced valat pays +/-500 per caller, including simultaneous calls, and never adds silent valat or other bonuses', () => {
  for (const [calls, count0, expected] of [
    [[0], 52, [500, 0]], [[1], 52, [0, -500]], [[0, 1], 52, [500, -500]], [[0, 1], 26, [-500, -500]],
  ]) {
    const game = finishPosition({ count0, last: ['clubs-2', 'clubs-1'], announcements: [...calls.map(player => ({ player, bonus: 'valat' })), { player: 0, bonus: 'kings' }] });
    assert.deepEqual(game.scoreboard[0].deltas, expected);
    assert.ok(game.scoreboard[0].breakdown.every(entry => entry.kind === 'valat' && entry.announced));
    assert.equal(game.scoreboard[0].breakdown.length, calls.length);
  }
});

test('mondfang records one public capture and a separate -21 penalty, including alongside valat', () => {
  const game = finishPosition({ count0: 52, last: ['tarok-22', 'tarok-21'], announcements: [{ player: 0, bonus: 'valat' }] });
  assert.deepEqual(game.mondfangs, [{ player: 1, winner: 0, trickNumber: 27 }]);
  assert.deepEqual(viewFor(game, 'ana').mondfangs, game.mondfangs);
  assert.deepEqual(game.scoreboard[0].deltas, [500, -21]);
  assert.deepEqual(game.scoreboard[0].breakdown, [
    { player: 0, kind: 'valat', points: 500, announced: true, success: true },
    { player: 1, kind: 'mondfang', points: -21, trickNumber: 27 },
  ]);
  const before = JSON.stringify(game);
  assert.throws(() => act(game, 'bor', { type: 'play', cardId: 'tarok-21' }));
  assert.equal(JSON.stringify(game), before);
  const normal = finishPosition({ last: ['tarok-21', 'tarok-22'] });
  assert.deepEqual(normal.mondfangs, [{ player: 0, winner: 1, trickNumber: 27 }]);
  assert.equal(normal.scoreboard[0].breakdown.filter(entry => entry.kind === 'mondfang').length, 1);
  const safeMond = finishPosition({ last: ['tarok-21', 'tarok-20'] });
  assert.deepEqual(safeMond.mondfangs, []);
});

test('announcements, confirmations, chosen pickups and mondfang survive JSON save and restore', () => {
  let game = announcementGame();
  game.players[0].hand = kings.map(card);
  game.players[0].stacks = [[card('tarok-22'), card('clubs-1')], [], []];
  act(game, 'ana', { type: 'announce', bonus: 'kings' });
  act(game, 'ana', { type: 'pickup', cardId: 'tarok-22' });
  act(game, 'ana', { type: 'confirmAnnouncements' });
  const before = viewFor(game, 'ana');
  game = JSON.parse(JSON.stringify(game));
  assert.deepEqual(viewFor(game, 'ana'), before);
  assert.deepEqual(legalAnnouncements(game, 'ana'), []);
  act(game, 'bor', { type: 'confirmAnnouncements' });
  assert.equal(game.phase, 'playing');
  const finished = finishPosition({ last: ['tarok-21', 'tarok-22'] });
  assert.deepEqual(viewFor(JSON.parse(JSON.stringify(finished)), 'bor'), viewFor(finished, 'bor'));
});

test('unmarked running rounds retain old phases and scoring; the next deal upgrades without rewriting history', () => {
  const bidding = makeGame();
  delete bidding.scoringVersion;
  takeTurn(bidding, { type: 'bid', bid: 'play' });
  assert.equal(bidding.phase, 'playing');
  assert.equal(viewFor(bidding, 'ana').scoringVersion, 1);
  const game = finishPosition({ legacy: true, count0: 52, last: ['tarok-22', 'tarok-21'] });
  assert.deepEqual(game.scoreboard[0].deltas, [35, 0]);
  assert.equal(game.scoreboard[0].breakdown, undefined);
  assert.deepEqual(game.mondfangs, []);
  const oldRow = structuredClone(game.scoreboard[0]);
  const oldTotals = game.players.map(player => player.score);
  act(game, 'ana', { type: 'ready' });
  act(game, 'bor', { type: 'ready' });
  assert.equal(game.scoringVersion, 2);
  assert.deepEqual(game.scoreboard, [oldRow]);
  assert.deepEqual(game.players.map(player => player.score), oldTotals);
  takeTurn(game, { type: 'bid', bid: 'play' });
  assert.equal(game.phase, 'announcements');
});
