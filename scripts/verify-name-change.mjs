// Exercise player name editing with real browsers and a disposable local server.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/name-change');
const report = { checks: [], layouts: [], browserErrors: [], passed: false };
const pages = [];
let dataDir, server, browser, origin;

function fixture(options) {
  let seed = 71;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const game = engine.createGame({ ...options, dealer: 0, rng });
  engine.act(game, game.players[game.turn].id, { type: 'bid', bid: 'play' });
  while (game.phase === 'playing') {
    const playerId = game.players[game.turn].id;
    engine.act(game, playerId, { type: 'play', cardId: engine.legalMoves(game, playerId)[0] });
  }
  for (const player of game.players) engine.act(game, player.id, { type: 'ready' });
  engine.act(game, game.players[game.turn].id, { type: 'bid', bid: 'pass' });
  engine.act(game, game.players[game.turn].id, { type: 'bid', bid: 'pass' });
  return game;
}

function observe(page) {
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => report.browserErrors.push(error.message));
  pages.push(page);
  return page;
}

async function fresh() {
  const context = await browser.newContext({ locale: 'sl-SI',
    viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('tarokza2.language', 'sl'));
  const page = observe(await context.newPage());
  await page.goto(origin);
  return page;
}

async function homeTab(page) {
  const tab = observe(await page.context().newPage());
  await tab.goto(origin);
  await expect(tab.getByRole('heading', { name: 'Moje mize', exact: true })).toBeVisible();
  return tab;
}

const dialog = page => page.locator('.game-settings-modal');
const input = page => page.getByTestId('settings-player-name');
const save = page => page.getByTestId('save-player-name');
const error = page => page.getByTestId('name-save-error');
const row = (page, roomId) => page.locator('.identity-table-row').filter({ hasText: roomId });
const savedRoom = roomId => readFile(path.join(dataDir, `${roomId}.json`), 'utf8');

async function openSettings(page) {
  await page.getByTestId('game-settings').click();
  await expect(input(page)).toBeVisible();
  await expect(dialog(page).getByTestId('language-select')).toBeVisible();
}

async function closeSettings(page) {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId('game-settings')).toBeFocused();
}

async function board(page) {
  return page.locator('.game-page').evaluate(element => ({
    data: { ...element.dataset },
    hand: [...element.querySelectorAll('.hand-cards [data-card-id]')].map(card => card.dataset.cardId),
  }));
}

async function layout(page, width) {
  await page.setViewportSize({ width, height: width === 320 ? 568 : 664 });
  const value = await dialog(page).evaluate(element => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    controls: [...element.querySelectorAll('button, input, select')].map(control => {
      const box = control.getBoundingClientRect();
      return { label: control.getAttribute('aria-label') || control.textContent.trim() || control.id,
        left: box.left, right: box.right, width: box.width, height: box.height };
    }),
  }));
  assert.ok(value.document <= value.viewport + 1, `${width}px settings does not overflow horizontally`);
  for (const control of value.controls) {
    assert.ok(control.left >= -1 && control.right <= value.viewport + 1, `${control.label} stays in the viewport`);
    assert.ok(control.width >= 43.5 && control.height >= 43.5, `${control.label} has a 44px touch target`);
  }
  report.layouts.push(value);
  await page.screenshot({ path: path.join(artifacts, `settings-${width}.png`), fullPage: true, animations: 'disabled' });
}

await mkdir(artifacts, { recursive: true });
try {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-name-change-'));
  server = await createTarokServer({ dataDir, engine: { ...engine, createGame: fixture },
    logger: { warn() {}, error() {} } });
  const address = await server.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const host = await fresh();
  await host.getByTestId('player-name').fill('Ana');
  await host.getByTestId('create-room').click();
  await expect(host.getByTestId('room-code')).toBeVisible();
  const roomId = (await host.getByTestId('room-code').textContent()).trim();
  const invitation = await host.getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue();
  await host.getByRole('button', { name: 'Naprave in obnovitev', exact: true }).click();
  await host.getByRole('button', { name: 'Dodaj novo napravo', exact: true }).click();
  const deviceLink = await host.getByRole('textbox', { name: 'Povezava za novo napravo', exact: true }).inputValue();
  const linked = await fresh();
  await linked.goto(deviceLink);
  await linked.getByRole('button', { name: 'Poveži brskalnik', exact: true }).click();
  await expect(linked.getByRole('heading', { name: 'Moje mize', exact: true })).toBeVisible();
  assert.notEqual(await linked.evaluate(() => localStorage.getItem('tarokza2.device')),
    await host.evaluate(() => localStorage.getItem('tarokza2.device')), 'Linked browsers use separate device credentials');
  await host.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();

  const guest = await fresh();
  await guest.goto(invitation);
  await guest.getByTestId('player-name').fill('Luka');
  await guest.getByTestId('join-room').click();
  await expect(host.locator('.game-page')).toHaveAttribute('data-phase', 'playing');
  await expect(guest.locator('.game-page')).toHaveAttribute('data-phase', 'playing');
  await row(linked, roomId).locator('.identity-table-card').click();
  await expect(linked.locator('.game-page')).toBeVisible();
  const hostHome = await homeTab(host), guestHome = await homeTab(guest);
  const initialRoom = await savedRoom(roomId);
  const initialBoard = await board(host);
  assert.ok(JSON.parse(initialRoom).game.scoreboard.length, 'Fixture includes completed score history');

  await openSettings(host);
  await openSettings(linked);
  await expect(input(host)).toHaveValue('Ana');
  await expect(save(host)).toBeDisabled();
  await input(host).fill('   ');
  await save(host).click();
  await expect(error(host)).toBeVisible();
  await expect(input(host)).toHaveAttribute('aria-invalid', 'true');
  await input(host).fill('x'.repeat(25));
  await input(host).press('Enter');
  await expect(error(host)).toBeVisible();
  assert.equal(await savedRoom(roomId), initialRoom, 'Invalid names do not alter the table');

  await input(host).fill('  Ana   Marija  ');
  await save(host).click();
  await expect(host.getByTestId('name-save-status')).toBeVisible();
  await expect(input(host)).toHaveValue('Ana Marija');
  await expect(save(host)).toBeDisabled();
  await expect(input(linked)).toHaveValue('Ana Marija');
  await expect(hostHome.locator('.identity-toolbar')).toContainText('Igraš kot Ana Marija.');
  await expect(row(guestHome, roomId).locator('strong')).toHaveText('Ana Marija');
  await expect(guest.locator('.opponent-name strong')).toHaveText('Ana Marija');
  await expect(host.locator('.hand-identity strong')).toContainText('Ana Marija');
  await expect(guest.locator('.score-button')).toHaveAttribute('aria-label', /Ana Marija/);
  await guest.locator('.score-button').click();
  await expect(guest.locator('.score-table thead')).toContainText('Ana Marija');
  await guest.getByTestId('score-details').first().locator('summary').click();
  await expect(guest.locator('.score-calculation-player h3').first()).toHaveText('Ana Marija');
  await guest.keyboard.press('Escape');
  report.checks.push('Blank and overlong names are rejected; button save normalizes whitespace and updates player labels, score history, opponent table lists and linked settings.');

  await input(linked).fill('Unsaved draft');
  await input(host).fill('Živa Novak');
  await input(host).press('Enter');
  await expect(input(host)).toHaveValue('Živa Novak');
  await expect(input(linked)).toHaveValue('Unsaved draft');
  await expect(hostHome.locator('.identity-toolbar')).toContainText('Igraš kot Živa Novak.');
  await closeSettings(linked);
  await openSettings(linked);
  await expect(input(linked)).toHaveValue('Živa Novak');
  await closeSettings(linked);
  report.checks.push('Enter saves Unicode names; another device keeps its unsaved draft and Escape discards it without overwriting the saved name.');

  // Make only this disposable registry temporarily unwritable. A failed save
  // must leave the draft recoverable and the durable/current name unchanged.
  const registry = path.join(dataDir, 'identities.json');
  await rename(registry, `${registry}.saved`);
  await mkdir(registry);
  try {
    await input(host).fill('Retry Name');
    await save(host).click();
    await expect(error(host)).toBeVisible();
    assert.ok((await error(host).textContent()).trim(), 'Storage failure explains why the name was not saved');
    await expect(input(host)).toHaveValue('Retry Name');
    await expect(guest.locator('.opponent-name strong')).toHaveText('Živa Novak');
    await expect(save(host)).toBeEnabled();
  } finally {
    await rm(registry, { recursive: true, force: true });
    await rename(`${registry}.saved`, registry);
  }
  await save(host).click();
  await expect(host.getByTestId('name-save-status')).toBeVisible();
  await expect(guest.locator('.opponent-name strong')).toHaveText('Retry Name');
  report.checks.push('Failed durable save preserves the draft, shows an inline error, leaves the old name visible and permits a successful retry.');

  await input(host).fill('Offline draft');
  await host.context().setOffline(true);
  await expect(host.getByText('Povezovanje …', { exact: true })).toBeVisible();
  await expect(save(host)).toBeDisabled();
  await expect(input(host)).toHaveValue('Offline draft');
  await host.context().setOffline(false);
  await expect(host.getByText('Pripravljeno na igro', { exact: true })).toBeVisible();
  await expect(input(host)).toHaveValue('Offline draft');
  await closeSettings(host);
  await openSettings(host);
  await expect(input(host)).toHaveValue('Retry Name');
  for (const width of [320, 390]) await layout(host, width);
  await closeSettings(host);
  await host.reload();
  await expect(host.locator('.game-page')).toBeVisible();
  await openSettings(host);
  await expect(input(host)).toHaveValue('Retry Name');
  await expect(host.locator('.hand-identity strong')).toContainText('Retry Name');
  assert.equal(await savedRoom(roomId), initialRoom, 'Renaming leaves the complete saved game, scores, turn and revision byte-for-byte unchanged');
  assert.deepEqual(await board(host), initialBoard, 'Renaming and reconnects preserve visible cards and game state');
  report.checks.push('Offline editing retains its draft with save disabled; cancellation and reload restore the saved name; 320px/390px settings fit with 44px targets.');
  report.checks.push('Every rename leaves the persisted room byte-for-byte unchanged, including cards, scores, turn and revision.');
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
  console.log('PASS: player name validation, save/Enter, linked-device updates, opponent/score labels, persistence, cancel/offline/failure recovery, mobile layout and unchanged gameplay.');
} catch (failure) {
  report.error = { message: failure.message, stack: failure.stack };
  process.exitCode = 1;
  console.error(failure.stack);
  if (pages[0]) await pages[0].screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
