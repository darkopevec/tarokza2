import test from 'node:test';
import assert from 'node:assert/strict';
import { explainScoreRow } from '../src/score-explanation.mjs';

const players = [{ name: 'Ana' }, { name: 'Luka' }];
const game = (player, points) => ({ player, kind: 'game', points });
const row = (contract, points, deltas, breakdown) => ({
  scoringVersion: 2, contract, points, deltas, breakdown,
});
const calculations = result => result.players.flatMap(player => player.lines.map(line => line.calculation).filter(Boolean));
const unavailable = result => result.players.every(player => player.lines[0].label.includes('niso na voljo'));

test('normal game explains both saved components and the winning-seat formula', () => {
  const result = explainScoreRow(row({ kind: 'normal', player: null }, [28, 42], [0, 7], [game(0, 0), game(1, 7)]), players);
  assert.equal(result.bidder, null);
  assert.equal(result.players[1].lines[0].calculation, '42 − 35 = +7');
  assert.match(result.players[0].lines[0].label, /samo zmagovalec/);
  assert.equal(result.players[1].total, '+7');
});

test('announced success and failure use each saved bidder seat, including negative difference × positive three', () => {
  for (const bidder of [0, 1]) {
    for (const [cardPoints, delta, formula] of [
      [42, 14, '(42 − 35) × 2 = +14'],
      [21, -42, '(21 − 35) × 3 = −42'],
    ]) {
      const points = [70 - cardPoints, 70 - cardPoints]; points[bidder] = cardPoints;
      const deltas = [0, 0]; deltas[bidder] = delta;
      const result = explainScoreRow(row({ kind: 'announced', player: bidder }, points, deltas,
        deltas.map((value, seat) => game(seat, value))), players);
      assert.equal(result.bidder, players[bidder].name);
      assert.equal(result.players[bidder].lines[0].calculation, formula);
      assert.match(result.players[1 - bidder].lines[0].label, /samo napovedovalec/);
      assert.equal(result.players[bidder].total, delta > 0 ? '+14' : '−42');
      assert.equal(result.players[1 - bidder].total, '0');
    }
  }
});

test('35-point ties explain unsuccessful calls and normalize positive or negative zero', () => {
  const announced = explainScoreRow(row({ kind: 'announced', player: 0 }, [35, 35], [-0, 0], [game(0, -0), game(1, 0)]), players);
  assert.match(announced.notes.join(' '), /35 točkah ni uspešna/);
  assert.equal(announced.players[0].lines[0].calculation, '(35 − 35) × 3 = 0');
  assert.equal(announced.players[0].total, '0');
  const normal = explainScoreRow(row({ kind: 'normal' }, [35, 35], [0, -0], [game(0, 0), game(1, -0)]), players);
  assert.match(normal.notes.join(' '), /izenačena/);
  assert.equal(normal.players[1].total, '0');
});

test('saved base, silent/called sets, and personal mondfang add to the saved delta', () => {
  const breakdown = [game(0, 14), game(1, 0),
    { player: 0, kind: 'kings', points: 20, announced: true, success: true },
    { player: 0, kind: 'trula', points: -20, announced: true, success: false },
    { player: 1, kind: 'trula', points: 10, announced: false, success: true },
    { player: 0, kind: 'mondfang', points: -21, trickNumber: 9 },
  ];
  const result = explainScoreRow(row({ kind: 'announced', player: 0 }, [42, 28], [-7, 10], breakdown), players);
  assert.equal(result.players[0].lines[0].calculation, '(42 − 35) × 2 = +14');
  assert.equal(result.players[0].total, '14 + 20 + (−20) + (−21) = −7');
  assert.equal(result.players[1].total, '0 + 10 = +10');
  assert.match(result.players[0].lines.at(-1).label, /9\. štihu/);
  assert.ok(result.players[1].lines.every(line => !line.label.includes('Mondfang')));
  for (const kind of ['kings', 'trula']) {
    const silent = explainScoreRow(row({ kind: 'normal' }, [42, 28], [17, 0], [game(0, 7), game(1, 0),
      { player: 0, kind, points: 10, announced: false, success: true }]), players);
    assert.equal(silent.players[0].total, '7 + 10 = +17');
  }
});

test('silent/called valat replaces base and sets while retaining bidder and separate mondfang', () => {
  for (const [announced, success, value] of [[false, true, 250], [true, true, 500], [true, false, -500]]) {
    const result = explainScoreRow(row({ kind: 'announced', player: 1 }, [46, 24], [value - 21, 0], [
      { player: 0, kind: 'valat', points: value, announced, success },
      { player: 0, kind: 'mondfang', points: -21 },
    ]), players);
    assert.equal(result.bidder, 'Luka');
    assert.match(result.notes.join(' '), /Valat nadomesti/);
    assert.ok(calculations(result).every(calculation => !calculation.includes('35')));
    assert.equal(result.players[0].total, `${value < 0 ? '(−500)' : value} + (−21) = ${value - 21 > 0 ? '+' : '−'}${Math.abs(value - 21)}`);
    assert.equal(result.players[1].total, '0');
  }
});

test('simultaneous valat calls settle independently, including two failed calls', () => {
  for (const firstWins of [false, true]) {
    const deltas = [firstWins ? 500 : -500, -500];
    const result = explainScoreRow(row({ kind: 'normal' }, [46, 24], deltas, [
      { player: 0, kind: 'valat', points: deltas[0], announced: true, success: firstWins },
      { player: 1, kind: 'valat', points: -500, announced: true, success: false },
    ]), players);
    assert.equal(result.players[0].total, firstWins ? '+500' : '−500');
    assert.equal(result.players[1].total, '−500');
  }
});

test('legacy rows retain their saved totals and never acquire modern bonuses', () => {
  const saved = { contract: { kind: 'normal' }, points: [70, 0], deltas: [35, 0],
    breakdown: [{ player: 0, kind: 'valat', points: 250, announced: false, success: true }] };
  const result = explainScoreRow(saved, players);
  assert.deepEqual(result.notes, ['Prejšnja pravila; shranjeni rezultat ostaja nespremenjen.']);
  assert.equal(result.players[0].lines[0].calculation, '70 − 35 = +35');
  assert.ok(calculations(result).every(calculation => !calculation.includes('250')));
  assert.equal(result.players[0].total, '+35');
  const failedCall = explainScoreRow({ scoringVersion: 1,
    contract: { kind: 'announced', player: 0 }, points: [21, 49], deltas: [-42, 0] }, players);
  assert.equal(failedCall.players[0].total, '−42');
});

test('incomplete, unknown, and inconsistent detail falls back instead of inventing arithmetic', () => {
  const complete = row({ kind: 'normal' }, [42, 28], [7, 0], [game(0, 7), game(1, 0)]);
  for (const saved of [
    { ...complete, breakdown: undefined },
    { ...complete, breakdown: [] },
    { ...complete, breakdown: [{ player: 3, kind: 'game', points: 7 }] },
    { ...complete, points: undefined },
  ]) {
    const result = explainScoreRow(saved, players);
    assert.ok(unavailable(result));
    assert.deepEqual(result.players.map(player => player.total), ['+7', '0']);
    assert.deepEqual(calculations(result), []);
  }
  const badTotal = explainScoreRow({ ...complete, deltas: [99, 0] }, players);
  assert.equal(badTotal.players[0].total, '+99');
  assert.equal(badTotal.players[0].lines[0].calculation, undefined);
  const unknown = explainScoreRow({ ...complete, breakdown: [game(0, 7), game(1, 0), { player: 0, kind: 'unknown', points: 0 }] }, players);
  assert.equal(unknown.players[0].lines[0].calculation, undefined);
  const badFormula = explainScoreRow({ ...complete, deltas: [8, 0], breakdown: [game(0, 8), game(1, 0)] }, players);
  assert.equal(badFormula.players[0].total, '+8');
  assert.equal(badFormula.players[0].lines[0].calculation, undefined);
  const mixedValat = explainScoreRow({ ...complete, deltas: [257, 0], breakdown: [...complete.breakdown,
    { player: 0, kind: 'valat', points: 250, announced: false, success: true }] }, players);
  assert.ok(unavailable(mixedValat));
});

test('explanations use saved contracts and leave deeply frozen inputs unchanged', () => {
  const saved = row({ kind: 'announced', player: 0 }, [21, 49], [-42, 0], [game(0, -42), game(1, 0)]);
  const deepFreeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  };
  const before = JSON.stringify(saved);
  deepFreeze(saved); deepFreeze(players);
  const result = explainScoreRow(saved, players);
  assert.equal(result.bidder, 'Ana');
  assert.equal(result.players[0].lines[0].calculation, '(21 − 35) × 3 = −42');
  assert.equal(JSON.stringify(saved), before);
});
