import { randomInt } from 'node:crypto';
import { cardFor, createDeck } from './cards.mjs';

export { createDeck } from './cards.mjs';

// The state contains data only, so a server can persist it with JSON.stringify.
// Injected random generators are useful for tests, but never travel to clients.
const randomGenerators = new WeakMap();
const secureRandom = () => randomInt(0, 0x100000000) / 0x100000000;
const suitOrder = ['tarok', 'clubs', 'spades', 'hearts', 'diamonds'];
const bonusSets = {
  kings: ['clubs-8', 'spades-8', 'hearts-8', 'diamonds-8'],
  trula: ['tarok-1', 'tarok-21', 'tarok-22'],
};

/** Traditional counting: subtract two per triple, one for remaining 1–2 cards. */
export function countPoints(cards) {
  const value = cards.reduce((sum, card) => sum + card.points, 0);
  return value - 2 * Math.floor(cards.length / 3) - (cards.length % 3 ? 1 : 0);
}

/** Exact thirds are kept for transparency, not used for the integer score. */
export function exactPoints(cards) {
  return cards.reduce((sum, card) => sum + card.points * 3 - 2, 0) / 3;
}

function sortHand(hand) {
  hand.sort((a, b) => suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit) || b.rank - a.rank);
}

function shuffledDeck(rng) {
  const deck = createDeck();
  for (let index = deck.length - 1; index > 0; index--) {
    const value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Neveljaven generator naključnih števil.');
    const other = Math.floor(value * (index + 1));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

function dealRound(game) {
  const deck = shuffledDeck(randomGenerators.get(game) ?? secureRandom);
  const first = 1 - game.dealer;
  for (const player of game.players) {
    player.hand = [];
    player.stacks = [[], [], []];
    player.captured = [];
    player.trickCount = 0;
    player.ready = false;
  }
  // Three packets of five, first to the non-dealer. There is no talon.
  for (let packet = 0; packet < 3; packet++) {
    for (const seat of [first, game.dealer]) game.players[seat].hand.push(...deck.splice(0, 5));
  }
  for (let stack = 0; stack < 3; stack++) {
    for (const seat of [first, game.dealer]) game.players[seat].stacks[stack] = deck.splice(0, 4);
  }
  for (const player of game.players) sortHand(player.hand);
  game.phase = 'bidding';
  game.turn = first;
  game.contract = { player: null, kind: 'normal' };
  game.bids = [];
  game.trick = [];
  game.lastTrick = null;
  game.trickNumber = 1;
  game.pickups = [];
  game.scoringVersion = 2;
  game.announcements = [];
  game.announcementReady = [false, false];
  game.mondfangs = [];
}

export function createGame({ playerIds, names, dealer, rng = secureRandom } = {}) {
  if (!Array.isArray(playerIds) || playerIds.length !== 2 || playerIds.some(id => typeof id !== 'string' || !id) || playerIds[0] === playerIds[1]) {
    throw new Error('Za igro potrebujemo dva različna igralca.');
  }
  if (!Array.isArray(names) || names.length !== 2 || names.some(name => typeof name !== 'string' || !name.trim())) throw new Error('Vnesita obe imeni.');
  if (typeof rng !== 'function') throw new Error('Neveljaven generator naključnih števil.');
  const selectedDealer = dealer ?? Math.floor(rng() * 2);
  if (selectedDealer !== 0 && selectedDealer !== 1) throw new Error('Neveljaven delilec.');
  const game = {
    version: 1, round: 1, dealer: selectedDealer,
    players: playerIds.map((id, seat) => ({ id, name: names[seat].trim(), score: 0 })),
    scoreboard: [],
  };
  randomGenerators.set(game, rng);
  dealRound(game);
  return game;
}

function playerIndex(game, playerId) {
  const seat = game.players.findIndex(player => player.id === playerId);
  if (seat < 0) throw new Error('Nisi igralec te igre.');
  return seat;
}

function startPlay(game) {
  // Pile tops become public, but taking an exposed honor is always optional.
  game.phase = 'playing';
  game.turn = 1 - game.dealer;
}

// Upgrade saved rounds that were waiting at the removed preparation step.
// Keep existing declarations for accurate scoring of games already in progress.
export function resumeGame(game) {
  if (game.phase === 'announcements') {
    game.phase = 'playing';
    game.turn = 1 - game.dealer;
  }
  return game;
}

export function preparationTurn() { return null; }

export function legalPickups(game, playerId) {
  const seat = playerIndex(game, playerId);
  if (game.phase !== 'playing') return [];
  return game.players[seat].stacks
    .map(stack => stack[0])
    .filter(card => card && (card.suit === 'tarok' || card.rank === 8))
    .map(card => card.id);
}

export function legalAnnouncements(game, playerId) {
  playerIndex(game, playerId);
  return [];
}

export function legalMoves(game, playerId) {
  const seat = playerIndex(game, playerId);
  if (game.phase !== 'playing' || game.turn !== seat) return [];
  const player = game.players[seat];
  const tops = player.stacks.filter(stack => stack.length).map(stack => stack[0]);
  if (!game.trick.length) return (player.hand.length ? player.hand : tops).map(card => card.id);
  const available = [...player.hand, ...tops];
  const ledSuit = game.trick[0].card.suit;
  const matching = available.filter(card => card.suit === ledSuit);
  if (matching.length) return matching.map(card => card.id);
  const trumps = available.filter(card => card.suit === 'tarok');
  return (trumps.length ? trumps : available).map(card => card.id);
}

function trickWinner(trick) {
  const [lead, reply] = trick;
  if (reply.card.suit === lead.card.suit) return reply.card.rank > lead.card.rank ? reply.player : lead.player;
  return reply.card.suit === 'tarok' ? reply.player : lead.player;
}

function scoreBreakdown(game, baseDeltas) {
  const breakdown = [];
  const announcements = game.announcements ?? [];
  const calledValats = announcements.filter(call => call.bonus === 'valat');
  const sweptBy = game.players.findIndex(player => player.trickCount === 27);
  if (calledValats.length) {
    for (const calledValat of calledValats) {
      const success = sweptBy === calledValat.player;
      breakdown.push({ player: calledValat.player, kind: 'valat', points: success ? 500 : -500, announced: true, success });
    }
  } else if (sweptBy >= 0) {
    breakdown.push({ player: sweptBy, kind: 'valat', points: 250, announced: false, success: true });
  } else {
    baseDeltas.forEach((points, player) => breakdown.push({ player, kind: 'game', points }));
    for (let player = 0; player < game.players.length; player++) {
      const captured = new Set(game.players[player].captured.map(card => card.id));
      for (const [kind, ids] of Object.entries(bonusSets)) {
        const announced = announcements.some(call => call.player === player && call.bonus === kind);
        const success = ids.every(id => captured.has(id));
        if (announced || success) breakdown.push({ player, kind, points: announced ? (success ? 20 : -20) : 10, announced, success });
      }
    }
  }
  for (const event of game.mondfangs ?? []) {
    breakdown.push({ player: event.player, kind: 'mondfang', points: -21, trickNumber: event.trickNumber });
  }
  return breakdown;
}

function finishRound(game) {
  const points = game.players.map(player => countPoints(player.captured));
  const precise = game.players.map(player => exactPoints(player.captured));
  const winner = points[0] === points[1] ? null : points[0] > points[1] ? 0 : 1;
  const deltas = [0, 0];
  let contractWon = null;
  if (game.contract.kind === 'announced') {
    const bidder = game.contract.player;
    contractWon = points[bidder] >= 36;
    const difference = points[bidder] - 35;
    deltas[bidder] = difference * (contractWon ? 2 : 3);
  } else if (winner !== null) {
    deltas[winner] = points[winner] - 35;
  }
  const breakdown = game.scoringVersion === 2 ? scoreBreakdown(game, deltas) : null;
  if (breakdown) {
    deltas.fill(0);
    for (const entry of breakdown) deltas[entry.player] += entry.points;
  }
  game.players.forEach((player, seat) => { player.score += deltas[seat]; });
  game.scoreboard.push({
    round: game.round, dealer: game.dealer, contract: { ...game.contract },
    points, exactPoints: precise, deltas, totals: game.players.map(player => player.score), winner, contractWon,
    ...(breakdown ? { scoringVersion: 2, announcements: structuredClone(game.announcements ?? []), breakdown } : {}),
  });
  game.phase = 'roundEnd';
  game.turn = null;
}

export function act(game, playerId, action) {
  const seat = playerIndex(game, playerId);
  if (!action || typeof action !== 'object') throw new Error('Neveljavna poteza.');
  if (action.type === 'pickup') {
    if (game.phase !== 'playing') throw new Error('Karto s kupčka lahko vzameš v roko po licitaciji ali med igro.');
    if (!legalPickups(game, playerId).includes(action.cardId)) throw new Error('V roko lahko vzameš le odprtega taroka ali kralja s svojega kupčka.');
    const player = game.players[seat];
    const stackIndex = player.stacks.findIndex(stack => stack[0]?.id === action.cardId);
    const card = player.stacks[stackIndex].shift();
    player.hand.push(card);
    sortHand(player.hand);
    game.pickups ??= [];
    game.pickups.push({ player: seat, card, stack: stackIndex, trickNumber: game.trickNumber });
    return game;
  }
  if (action.type === 'announce' || action.type === 'confirmAnnouncements') {
    throw new Error('Napovedi in potrjevanje priprave niso več del igre.');
  }
  if (action.type === 'ready') {
    if (game.phase !== 'roundEnd') throw new Error('Runda še ni končana.');
    game.players[seat].ready = true;
    if (game.players.every(player => player.ready)) {
      game.round++;
      game.dealer = 1 - game.dealer;
      dealRound(game);
    }
    return game;
  }
  if (game.turn !== seat) throw new Error('Počakaj, da boš na vrsti.');
  if (action.type === 'bid') {
    if (game.phase !== 'bidding') throw new Error('Licitacija je že zaključena.');
    if (!['play', 'pass'].includes(action.bid)) throw new Error('Izberi »Igram« ali »Naprej«.');
    game.bids.push({ player: seat, bid: action.bid });
    if (action.bid === 'play') {
      game.contract = { player: seat, kind: 'announced' };
      startPlay(game);
    } else if (game.bids.length === 2) {
      startPlay(game);
    } else {
      game.turn = game.dealer;
    }
    return game;
  }
  if (action.type !== 'play') throw new Error('Neveljavna poteza.');
  if (game.phase !== 'playing') throw new Error('Karte še ne moreš odigrati.');
  if (!legalMoves(game, playerId).includes(action.cardId)) throw new Error('Te karte ne moreš odigrati. Sledi barvi, sicer igraj tarok. Kupčki lahko začnejo štih šele, ko je roka prazna.');
  const player = game.players[seat];
  const handIndex = player.hand.findIndex(card => card.id === action.cardId);
  let card;
  if (handIndex >= 0) {
    [card] = player.hand.splice(handIndex, 1);
  } else {
    const stack = player.stacks.find(pile => pile[0]?.id === action.cardId);
    card = stack.shift();
  }
  game.trick.push({ player: seat, card });
  if (game.trick.length === 1) {
    game.turn = 1 - seat;
  } else {
    const winner = trickWinner(game.trick);
    if (game.scoringVersion === 2) {
      const mond = game.trick.find(play => play.card.id === 'tarok-21');
      if (mond && mond.player !== winner && game.trick.some(play => play.card.id === 'tarok-22')) {
        game.mondfangs ??= [];
        game.mondfangs.push({ player: mond.player, winner, trickNumber: game.trickNumber });
      }
    }
    game.players[winner].captured.push(...game.trick.map(play => play.card));
    game.players[winner].trickCount++;
    game.lastTrick = { winner, cards: game.trick, number: game.trickNumber };
    game.trick = [];
    game.turn = winner;
    if (game.trickNumber === 27) finishRound(game);
    else game.trickNumber++;
  }
  return game;
}

// Display current names and artwork even when resuming an older saved game.
// The original persisted cards and gameplay data remain untouched.
const publicCard = card => card ? (cardFor(card.id) ?? card) : null;
const publicPlay = play => ({ ...play, card: publicCard(play.card) });

export function viewFor(game, playerId) {
  const you = playerIndex(game, playerId);
  const captured = game.players[you].captured;
  // Deliberately construct the public projection. Never spread an internal player.
  const view = {
    phase: game.phase, round: game.round, dealer: game.dealer, turn: game.turn, you,
    scoringVersion: game.scoringVersion ?? 1,
    players: game.players.map(player => ({
      id: player.id, name: player.name, handCount: player.hand.length,
      stacks: player.stacks.map(stack => ({ count: stack.length, top: game.phase === 'bidding' ? null : publicCard(stack[0]) })),
      trickCount: player.trickCount, score: player.score, ready: player.ready,
    })),
    hand: game.players[you].hand.map(publicCard),
    // Captured cards are already saved in completed pairs, in winning order.
    // Derive history for existing rounds too, without adding or migrating state.
    wonTricks: Array.from({ length: Math.ceil(captured.length / 2) }, (_, index) =>
      captured.slice(index * 2, index * 2 + 2).map(publicCard)),
    legalMoves: legalMoves(game, playerId),
    legalPickups: legalPickups(game, playerId),
    legalAnnouncements: legalAnnouncements(game, playerId),
    announcements: game.announcements ?? [],
    announcementReady: game.announcementReady ?? [false, false],
    preparationTurn: preparationTurn(game),
    mondfangs: game.mondfangs ?? [],
    legalBids: game.phase === 'bidding' && game.turn === you ? ['play', 'pass'] : [],
    trick: game.trick.map(publicPlay),
    lastTrick: game.lastTrick ? { ...game.lastTrick, cards: game.lastTrick.cards.map(publicPlay) } : null,
    trickNumber: game.trickNumber,
    contract: game.contract, bids: game.bids, scoreboard: game.scoreboard,
    pickups: (game.pickups ?? []).map(publicPlay),
    ready: game.players.map(player => player.ready),
  };
  return structuredClone(view);
}
