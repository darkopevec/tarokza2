// Read-only history checks against a completed, legally played disposable round.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/trick-history');
const expected = [[], []];
const report = { checks: [], browserErrors: [], passed: false };
function fixture(options) {
  let seed = 71;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const game = engine.createGame({ ...options, dealer: 0, rng });
  engine.act(game, game.players[game.turn].id, { type: 'bid', bid: 'play' });
  while (game.phase === 'announcements') engine.act(game, game.players[engine.preparationTurn(game)].id, { type: 'confirmAnnouncements' });
  while (game.phase === 'playing') {
    const playerId = game.players[game.turn].id;
    engine.act(game, playerId, { type: 'play', cardId: engine.legalMoves(game, playerId)[0] });
    if (!game.trick.length) expected[game.lastTrick.winner].push(game.lastTrick.cards.map(play => play.card.id));
  }
  assert.equal(expected.flat().length, 27);
  assert.ok(expected.every(tricks => tricks.length > 1));
  return game;
}
await mkdir(artifacts, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-trick-history-'));
let server, browser;
try {
  server = await createTarokServer({ dataDir, engine: { ...engine, createGame: fixture } });
  const address = await server.listen(0, '127.0.0.1');
  const baseURL = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  pages.forEach(page => { page.setDefaultTimeout(10_000); page.on('pageerror', error => report.browserErrors.push(error.message)); });
  await pages[0].goto(baseURL);
  if (await pages[0].getByTestId('player-name').count()) await pages[0].getByTestId('player-name').fill('Ana');
  await pages[0].getByTestId('create-room').click();
  const code = (await pages[0].getByTestId('room-code').textContent()).trim();
  await pages[1].goto(await pages[0].getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue(), { waitUntil: 'networkidle' });
  if (await pages[1].getByTestId('player-name').count()) await pages[1].getByTestId('player-name').fill('Luka');
  await pages[1].getByTestId('join-room').click();
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', 'roundEnd')));
  const savePath = path.join(dataDir, `${code}.json`);
  const savedBefore = await readFile(savePath, 'utf8');

  for (const [seat, page] of pages.entries()) {
    await expect(page.getByTestId('my-tricks')).toHaveCount(1);
    await expect(page.locator('.game-toolbar').getByTestId('my-tricks')).toHaveCount(0);
    for (const [width, height] of [[320, 568], [630, 680], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await page.getByTestId('my-tricks').tap();
      const dialog = page.getByRole('dialog', { name: 'Tvoji štihi', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('won-trick')).toHaveCount(expected[seat].length);
      const cards = await dialog.getByTestId('won-trick').evaluateAll(rows => rows.map(row =>
        [...row.querySelectorAll('.playing-card')].map(card => card.dataset.cardId)));
      assert.deepEqual(cards, expected[seat], 'All and only this player’s won pairs must be shown in winning order.');
      await dialog.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await expect(dialog.locator('[data-testid="play-card"]')).toHaveCount(0);
      await dialog.getByTestId('won-trick').last().scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('button', { name: 'Zapri', exact: true })).toBeInViewport();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(artifacts, `seat-${seat}-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('my-tricks')).toBeFocused();
      report.checks.push({ seat, width, height, pairs: cards.length, passed: true });
    }
  }
  await pages[0].reload();
  await pages[0].getByTestId('my-tricks').click();
  await expect(pages[0].getByTestId('won-trick')).toHaveCount(expected[0].length);
  await pages[0].keyboard.press('Escape');
  assert.equal(await readFile(savePath, 'utf8'), savedBefore, 'Viewing and refreshing must not change saved cards, scores, or readiness.');
  await pages[0].getByTestId('new-round').click();
  await pages[0].getByTestId('my-tricks').click();
  await expect(pages[0].getByTestId('won-trick')).toHaveCount(expected[0].length);
  await pages[0].keyboard.press('Escape');
  await pages[1].getByTestId('new-round').click();
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-round', '2')));
  for (const page of pages) {
    await expect(page.locator('.bottom-table .trick-stat')).toHaveCount(1);
    await expect(page.locator('.game-toolbar').getByTestId('my-tricks')).toHaveCount(0);
    await page.getByTestId('my-tricks').click();
    await expect(page.getByTestId('won-tricks-empty')).toBeVisible();
    await expect(page.getByTestId('won-trick')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await pages[0].getByTestId('bid-play').click();
  await pages[0].getByTestId('confirm-announcements').click();
  await pages[1].getByTestId('confirm-announcements').click();
  const lead = pages[0].locator('[data-testid="play-card"]:enabled').first();
  const leadId = await lead.getAttribute('data-card-id');
  await lead.click();
  const reply = pages[1].locator('[data-testid="play-card"]:enabled').first();
  await expect(reply).toBeVisible();
  const replyId = await reply.getAttribute('data-card-id');
  await reply.click();
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-trick-number', '2')));
  const winner = Number(await pages[0].locator('.game-page').getAttribute('data-turn'));
  for (const [seat, page] of pages.entries()) {
    await page.getByTestId('my-tricks').click();
    await expect(page.getByTestId('won-trick')).toHaveCount(seat === winner ? 1 : 0);
    if (seat === winner) assert.deepEqual(await page.getByTestId('won-trick').locator('.playing-card')
      .evaluateAll(cards => cards.map(card => card.dataset.cardId)), [leadId, replyId]);
    await page.keyboard.press('Escape');
  }
  report.liveTrickVerified = true;
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
  console.log('PASS: both private trick histories, all 27 pairs, three sizes, keyboard/focus, refresh, unchanged saves, next-round reset, and a new live trick.');
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error.stack);
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(dataDir, { recursive: true, force: true });
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
