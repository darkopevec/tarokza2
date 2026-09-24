// Deterministic presentation fixtures only: no production data or seed API.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/score-history');
const report = { startedAt: new Date().toISOString(), screenshots: [], layouts: [], cases: [], browserErrors: [] };
const viewports = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }];
const gameEntry = (player, points) => ({ player, kind: 'game', points });
const normal = { kind: 'normal', player: null };
const announced = player => ({ kind: 'announced', player });
const definitions = [
  { points: [21, 49], contract: announced(0), deltas: [-42, 0], breakdown: [gameEntry(0, -42), gameEntry(1, 0)] },
  { points: [28, 42], contract: announced(1), deltas: [0, 14], breakdown: [gameEntry(0, 0), gameEntry(1, 14)] },
  { points: [40, 30], contract: normal, deltas: [5, 0], breakdown: [gameEntry(0, 5), gameEntry(1, 0)] },
  { points: [35, 35], contract: normal, deltas: [0, 0], breakdown: [gameEntry(0, 0), gameEntry(1, 0)] },
  { points: [48, 22], contract: normal, deltas: [33, -21], breakdown: [gameEntry(0, 13), gameEntry(1, 0),
    { player: 0, kind: 'kings', points: 10, announced: false, success: true },
    { player: 0, kind: 'trula', points: 10, announced: false, success: true },
    { player: 1, kind: 'mondfang', points: -21, trickNumber: 17 }] },
  { points: [62, 8], contract: announced(0), deltas: [-500, 0],
    breakdown: [{ player: 0, kind: 'valat', points: -500, announced: true, success: false }] },
  { points: [30, 40], contract: announced(1), deltas: [0, 10] }, // Saved legacy row: no inferred extras.
  { points: [70, 0], contract: normal, deltas: [250, 0],
    breakdown: [{ player: 0, kind: 'valat', points: 250, announced: false, success: true }] },
];
function history() {
  let totals = [0, 0];
  return definitions.map((definition, index) => {
    totals = totals.map((total, seat) => total + definition.deltas[seat]);
    const row = { ...structuredClone(definition), round: index + 1, dealer: index % 2,
      exactPoints: [...definition.points], totals: [...totals],
      winner: definition.points[0] === definition.points[1] ? null : definition.points[0] > definition.points[1] ? 0 : 1,
      contractWon: definition.contract.kind === 'announced' ? definition.points[definition.contract.player] >= 36 : null,
      ...(definition.breakdown ? { scoringVersion: 2, announcements: definition.announcements || [] } : {}) };
    // Incomplete historical metadata: the saved breakdown remains authoritative.
    if (index === 5) delete row.announcements;
    if (row.breakdown) assert.deepEqual([0, 1].map(seat => row.breakdown.filter(entry => entry.player === seat).reduce((sum, entry) => sum + entry.points, 0)), row.deltas);
    return row;
  });
}
let createdGames = 0;
function fixture(options) {
  const game = engine.createGame({ ...options, dealer: 1, rng: () => 0.37 });
  game.scoreboard = history();
  game.players.forEach((player, index) => { player.score = game.scoreboard.at(-1).totals[index]; });
  if (createdGames++ === 0) {
    game.round = 9; // A different live contract must never explain older rows.
    game.contract = { ...normal };
  } else {
    game.round = 8; game.phase = 'roundEnd'; game.turn = null; game.trickNumber = 27;
    game.players.forEach((player, index) => {
      player.hand = []; player.stacks = [[], [], []];
      player.captured = index === 0 ? engine.createDeck() : []; player.trickCount = index === 0 ? 27 : 0;
    });
  }
  return game;
}

let server, browser, dataDir;
const pages = [];
const text = value => value.replaceAll('−', '-').replace(/\s+/g, ' ').trim();
const detail = (page, round) => page.locator(`[data-testid="score-details"][data-round="${round}"]`);
async function persistedGame(room) { return JSON.parse(await readFile(path.join(dataDir, `${room}.json`), 'utf8')).game; }
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(artifacts, name), animations: 'disabled' }); report.screenshots.push(name);
}
async function createRoom(url) {
  await Promise.all(pages.map(page => page.goto(url, { waitUntil: 'networkidle' })));
  if (await pages[0].getByTestId('player-name').count()) await pages[0].getByTestId('player-name').fill('Ana'); await pages[0].getByTestId('create-room').click();
  await pages[0].getByTestId('room-code').waitFor();
  const room = (await pages[0].getByTestId('room-code').textContent()).trim();
  await pages[1].goto(await pages[0].getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue(), { waitUntil: 'networkidle' });
  if (await pages[1].getByTestId('player-name').count()) await pages[1].getByTestId('player-name').fill('Luka'); await pages[1].getByTestId('join-room').click();
  await Promise.all(pages.map(page => page.locator('.game-page').waitFor()));
  return room;
}
async function inspectLayout(page, label) {
  const measurements = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    tableWidths: [...document.querySelectorAll('.score-table-wrap')].map(element => ({ client: element.clientWidth, scroll: element.scrollWidth })),
    summaries: [...document.querySelectorAll('[data-testid="score-details"] summary')].map(element => {
      const r = element.getBoundingClientRect(); return { width: r.width, height: r.height };
    }) }));
  assert.ok(measurements.documentWidth <= measurements.width + 1, `${label}: no document horizontal overflow.`);
  assert.ok(measurements.tableWidths.every(table => table.scroll <= table.client + 1), `${label}: the score table must not require horizontal scrolling.`);
  assert.ok(measurements.summaries.every(summary => summary.width >= 43.9 && summary.height >= 43.9), `${label}: calculation summaries must be 44px touch targets.`);
  report.layouts.push({ label, ...measurements });
}
async function inspectRoundEndScroll(page, label) {
  await page.locator('.round-end-body').waitFor();
  await page.locator('.round-end').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const measurements = await page.evaluate(() => {
    const game = document.querySelector('.game-page');
    const body = document.querySelector('.round-end-body');
    const bounds = body.getBoundingClientRect();
    const inside = element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    };
    return { width: innerWidth, height: innerHeight, transform: getComputedStyle(game).transform,
      bodyHeight: body.clientHeight, contentHeight: body.scrollHeight,
      bottomGap: body.scrollHeight - body.clientHeight - body.scrollTop,
      horizontalOverflow: body.scrollWidth - body.clientWidth,
      pageOverflow: game.scrollHeight - game.clientHeight,
      latestScoreVisible: inside([...body.querySelectorAll('[data-testid="scoreboard-row"]')].at(-1).querySelector('td:nth-child(2) strong')),
      totalsVisible: inside(body.querySelector('tfoot')),
      namesVisible: [...document.querySelectorAll('.round-end-player-heading strong')].every(element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= bounds.top + 1; }),
      fixedElements: ['.site-header', '.game-footer'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, top: rect.top, bottom: rect.bottom, height: rect.height };
      }) };
  });
  assert.ok(measurements.namesVisible, `${label}: player names stay visible while scores scroll.`);
  assert.equal(measurements.transform, 'none', `${label}: result text must remain at its native size.`);
  assert.ok(measurements.bodyHeight > 0 && measurements.contentHeight > measurements.bodyHeight, `${label}: score history must scroll within the results panel.`);
  assert.ok(Math.abs(measurements.bottomGap) <= 2, `${label}: results must initially scroll to the bottom.`);
  assert.ok(measurements.horizontalOverflow <= 1 && measurements.pageOverflow <= 1, `${label}: only the results body should scroll vertically.`);
  assert.ok(measurements.fixedElements.every(element => element.height > 0 && element.top >= -1 && element.bottom <= measurements.height + 1),
    `${label}: the header and footer must remain in the viewport.`);
  if (measurements.width === 390) assert.ok(measurements.latestScoreVisible, `${label}: the latest score must be visible on phone portrait.`);
  if (measurements.width === 320) assert.ok(measurements.totalsVisible, `${label}: totals must be visible on the smallest phone.`);
  await inspectLayout(page, label);
  report.layouts.push({ label, ...measurements });
}
async function inspectRows(page, mode) {
  const rows = page.getByTestId('scoreboard-row');
  assert.equal(await rows.count(), 8); assert.equal(await page.getByTestId('score-details').count(), 8);
  assert.match(await rows.nth(0).getByTestId('score-bidder').innerText(), /Ana/);
  assert.match(await rows.nth(1).getByTestId('score-bidder').innerText(), /Luka/);
  assert.match(await rows.nth(5).locator('td').first().innerText(), /Napovedan valat/,
    'A saved announced-valat breakdown must determine the row label without a separate announcements array.');
  for (let round = 1; round <= 8; round++) {
    const section = detail(page, round);
    if (!(await section.evaluate(element => element.open))) await section.locator('summary').click();
    const calculation = section.locator('.score-calculation');
    const copy = text(await calculation.innerText());
    assert.equal(await calculation.locator('.score-calculation-player').count(), 2);
    const totals = await calculation.locator('.score-calculation-total strong').allTextContents();
    assert.deepEqual(totals.map(value => Number(text(value).split('=').at(-1).trim())), definitions[round - 1].deltas,
      'Each saved component equation must end in the recorded round delta.');
    if (round === 1) assert.ok(copy.includes('(21 - 35) × 3 = -42'), 'Ana’s old loss must use her own 21 points and triple penalty.');
    if (round === 2) assert.ok(copy.includes('(42 - 35) × 2 = +14'), 'Luka’s later win must use his own saved contract.');
    if (round === 3) assert.match(copy, /40\s*-\s*35.*\+5/);
    if (round === 4) assert.match(copy, /35|izenačen/i);
    if (round === 5) { assert.match(copy, /Kralji/i); assert.match(copy, /Trula/i); assert.match(copy, /Mondfang/i); assert.ok(copy.includes('-21')); }
    if ([6, 8].includes(round)) {
      assert.match(copy, /valat/i);
      assert.ok(!(await calculation.locator('.score-formula').allTextContents()).some(formula => /[−-]\s*35/.test(formula)), 'Valat replacement must not add a base-game formula.');
    }
    if (round === 7) {
      assert.match(copy, /prejšnj|starej|shranjen/i);
      assert.equal(await rows.nth(6).getByTestId('score-breakdown-entry').count(), 0);
      assert.ok(!(await calculation.locator('.score-calculation-player li').allTextContents()).some(line => /kralji|trula|valat|mondfang/i.test(line)), 'Legacy rows must not acquire modern bonus lines.');
    }
    const viewport = page.viewportSize();
    await inspectLayout(page, `${mode}-round-${round}-${viewport.width}x${viewport.height}`);
    if ([390, 768].includes(viewport.width) && [2, 5, 6, 7].includes(round)) {
      const filename = `${mode}-round-${round}-${viewport.width}x${viewport.height}.png`;
      await section.screenshot({ path: path.join(artifacts, filename), animations: 'disabled' });
      report.screenshots.push(filename);
    }
    await section.locator('summary').click();
  }
}

await mkdir(artifacts, { recursive: true });
try {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-score-history-'));
  server = await createTarokServer({ dataDir, engine: { ...engine, createGame: fixture } });
  const address = await server.listen(0, '127.0.0.1'); const url = `http://127.0.0.1:${address.port}`;
  let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch {} }
  browser = await chromium.launch({ headless: process.env.HEADLESS !== '0', ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({ viewport: viewports[index], isMobile: true, hasTouch: true });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.browserErrors.push(error.message)); pages.push(page);
  }
  for (const mode of ['modal', 'round-end']) {
    if (mode === 'round-end') for (const page of pages) {
      await page.getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
      await page.getByTestId('create-room').waitFor();
    }
    const room = await createRoom(url); const original = await persistedGame(room);
    if (mode === 'modal') await pages[0].locator('.score-button').click();
    await detail(pages[0], 1).waitFor();
    if (mode === 'round-end') await inspectRoundEndScroll(pages[0], 'round-end-initial');
    if (mode === 'modal') {
      const close = pages[0].getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true });
      await close.focus(); await pages[0].keyboard.press('Tab');
      assert.equal(await detail(pages[0], 1).locator('summary').evaluate(element => element === document.activeElement), true);
      await pages[0].keyboard.press('Shift+Tab'); assert.equal(await close.evaluate(element => element === document.activeElement), true);
    }
    await detail(pages[0], 1).locator('summary').focus(); await pages[0].keyboard.press('Space');
    assert.equal(await detail(pages[0], 1).evaluate(element => element.open), true);
    await pages[0].keyboard.press('Enter'); assert.equal(await detail(pages[0], 1).evaluate(element => element.open), false);
    for (const viewport of viewports) {
      await pages[0].setViewportSize(viewport);
      if (mode === 'round-end') {
        await pages[0].reload({ waitUntil: 'networkidle' });
        await inspectRoundEndScroll(pages[0], `round-end-bottom-${viewport.width}x${viewport.height}`);
        await screenshot(pages[0], `round-end-bottom-${viewport.width}x${viewport.height}.png`);
      }
      await inspectRows(pages[0], mode);
      await detail(pages[0], 1).locator('summary').click();
      await detail(pages[0], 1).locator('.score-formula').first().scrollIntoViewIfNeeded();
      await inspectLayout(pages[0], `${mode}-${viewport.width}x${viewport.height}`);
      await screenshot(pages[0], `${mode}-${viewport.width}x${viewport.height}.png`);
      await detail(pages[0], 1).locator('summary').click();
    }
    if (mode === 'modal') { await pages[0].keyboard.press('Escape'); assert.equal(await pages[0].getByRole('dialog').count(), 0); }
    assert.deepEqual(await persistedGame(room), original, 'Expanding or closing history must never mutate saved game state.');
    await pages[0].reload({ waitUntil: 'networkidle' }); await pages[0].locator('.game-page').waitFor();
    if (mode === 'modal') await pages[0].locator('.score-button').click();
    else await inspectRoundEndScroll(pages[0], 'round-end-refresh');
    await inspectRows(pages[0], mode); assert.deepEqual(await persistedGame(room), original, 'Refresh must preserve every saved row and the current game.');
    if (mode === 'modal') await pages[0].getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
    else {
      await pages[0].setViewportSize(viewports[1]);
      await pages[0].reload({ waitUntil: 'networkidle' });
      await inspectRoundEndScroll(pages[0], 'round-end-before-ready');
      await detail(pages[0], 2).locator('summary').scrollIntoViewIfNeeded();
      const before = await pages[0].locator('.round-end-body').evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
      assert.ok(before.top < before.max - 100, 'Earlier score rows must remain reachable by scrolling.');
      await pages[1].getByTestId('new-round').click();
      await pages[0].waitForFunction(() => document.querySelector('[data-testid="ready-count"]').textContent.trim().startsWith('1/2'));
      const after = await pages[0].locator('.round-end-body').evaluate(element => element.scrollTop);
      assert.ok(Math.abs(after - before.top) <= 2, 'An opponent readiness update must preserve the position while reading older rounds.');
      const expected = structuredClone(original); expected.players[1].ready = true;
      assert.deepEqual(await persistedGame(room), expected, 'A readiness update must only change the opponent readiness flag.');
    }
    report.cases.push({ mode, room, historicalRows: 8, passed: true });
  }
  assert.equal(report.browserErrors.length, 0); report.passed = true;
  console.log('PASS: saved bidders/formulas, eight scoring cases, five sizes, keyboard expansion, modal focus, refresh, readable scrolling, preserved scroll position, and immutable score history.');
} catch (error) {
  report.passed = false; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack);
  if (pages[0]) await screenshot(pages[0], 'failure.png').catch(() => {});
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
