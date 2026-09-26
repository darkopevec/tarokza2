// Exercise real translations through independent browsers and the Socket.IO server.
// All rooms and identities are disposable; production data is never opened.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';

const languages = ['sl', 'en', 'es', 'de', 'fr', 'it', 'cs', 'sk', 'hu', 'da', 'ro', 'pl'];
const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/language');
const report = { checks: [], browserErrors: [], passed: false };
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-language-'));
let server, browser;

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
  return game;
}

const language = page => page.getByTestId('language-select');
async function openSettings(page) {
  await expect(page.getByTestId('game-settings')).toBeVisible();
  await expect(page.locator('.site-header').getByTestId('language-select')).toHaveCount(0);
  await page.getByTestId('game-settings').click();
  await expect(page.getByRole('dialog').getByTestId('language-select')).toBeVisible();
}
async function choose(page, locale) {
  const inGame = await page.locator('.game-page').isVisible();
  if (inGame) await openSettings(page);
  await language(page).selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(language(page)).toHaveValue(locale);
  if (inGame) {
    await noOverflow(page, `${locale} game settings`);
    await closeDialog(page);
    await expect(page.getByTestId('game-settings')).toBeFocused();
  }
}
async function expectGameLanguage(page, locale) {
  await openSettings(page);
  await expect(language(page)).toHaveValue(locale);
  await closeDialog(page);
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.width + 1, `${label}: ${dimensions.content}px content overflows ${dimensions.width}px viewport.`);
}
async function board(page) {
  return page.locator('.game-page').evaluate(element => ({ ...element.dataset }));
}
async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

await mkdir(artifacts, { recursive: true });
try {
  server = await createTarokServer({ dataDir, engine: { ...engine, createGame: fixture } });
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) {
    try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch { /* Use Playwright's installed browser. */ }
  }
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  async function fresh(locale, width = 390, configure) {
    const context = await browser.newContext({ locale, viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.browserErrors.push(error.message));
    await configure?.(page);
    await page.goto(origin);
    await expect(language(page)).toBeVisible();
    await expect(page.getByTestId('game-settings')).toHaveCount(0);
    return page;
  }

  const unknown = await fresh('ja-JP');
  await expect(language(unknown)).toHaveValue('en');
  await expect(unknown.locator('html')).toHaveAttribute('lang', 'en');
  await unknown.context().close();
  report.checks.push('Unsupported browser languages fall back to English.');

  // Deterministic country responses exercise the production browser code without depending on this machine's IP.
  for (const [country, browserLocale, expected] of [
    ['SI', 'en-US', 'sl'], ['MX', 'en-US', 'es'], ['CH', 'fr-CH', 'fr'], ['BE', 'de-DE', 'de'], ['CA', 'fr-CA', 'fr'],
  ]) {
    const page = await fresh(browserLocale, 390, page => page.route('**/api/locale', route => route.fulfill({ json: { country } })));
    await expect(language(page)).toHaveValue(expected);
    await expect(page.locator('html')).toHaveAttribute('lang', expected);
    assert.equal(await page.evaluate(() => localStorage.getItem('tarokza2.language')), null, 'Inferred language must not become a saved preference.');
    await page.context().close();
  }
  let country = 'SI';
  let automaticRequests = 0;
  const automatic = await fresh('en-US', 390, page => page.route('**/api/locale', route => {
    automaticRequests++;
    return route.fulfill({ json: { country } });
  }));
  await expect(language(automatic)).toHaveValue('sl');
  country = 'AT';
  await automatic.reload();
  await expect(language(automatic)).toHaveValue('de');
  assert.equal(automaticRequests, 2, 'Each visit should resolve country once when there is no saved choice.');
  await automatic.context().close();
  report.checks.push('IP country sets the default, including multilingual countries; inferred choices are not saved and update on a later visit.');

  let savedRequests = 0;
  const saved = await fresh('en-US', 390, async page => {
    await page.addInitScript(() => localStorage.setItem('tarokza2.language', 'pl'));
    await page.route('**/api/locale', route => { savedRequests++; return route.fulfill({ json: { country: 'SI' } }); });
  });
  await expect(language(saved)).toHaveValue('pl');
  assert.equal(savedRequests, 0, 'A saved explicit preference must skip country lookup.');
  await saved.context().close();

  for (const [browserLocale, selection, blockStorage] of [['en-US', 'es', false], ['en-US', 'en', true]]) {
    let pending;
    const page = await fresh(browserLocale, 390, async page => {
      if (blockStorage) await page.addInitScript(() => {
        for (const method of ['getItem', 'setItem']) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (key, ...args) {
            if (key === 'tarokza2.language') throw new DOMException('Storage disabled', 'SecurityError');
            return original.call(this, key, ...args);
          };
        }
      });
      await page.route('**/api/locale', route => { pending = route; });
    });
    await expect(language(page)).toHaveValue('en');
    await expect.poll(() => Boolean(pending)).toBe(true);
    await choose(page, selection);
    const response = page.waitForResponse('**/api/locale');
    await pending.fulfill({ json: { country: 'SI' } });
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(language(page)).toHaveValue(selection);
    await page.context().close();
  }
  report.checks.push('Saved choices skip IP lookup; delayed responses preserve manual choices, including the current language with disabled storage.');

  for (const result of ['missing', 'failure', 'malformed']) {
    const page = await fresh('es-MX', 390, page => page.route('**/api/locale', route => {
      if (result === 'failure') return route.fulfill({ status: 503, json: {} });
      if (result === 'malformed') return route.fulfill({ contentType: 'application/json', body: '{invalid' });
      return route.fulfill({ json: { country: null } });
    }));
    await expect(language(page)).toHaveValue('es');
    await page.context().close();
  }
  let timedOut = false;
  let timeoutRoute;
  const timeout = await fresh('es-MX', 390, async page => {
    page.on('requestfailed', request => { if (request.url().endsWith('/api/locale')) timedOut = true; });
    await page.route('**/api/locale', route => { timeoutRoute = route; });
  });
  await expect(language(timeout)).toHaveValue('es');
  await expect.poll(() => timedOut, { timeout: 5000 }).toBe(true);
  await timeoutRoute.fulfill({ json: { country: 'SI' } }).catch(() => {}); // Chromium may already have closed the aborted route.
  await expect(language(timeout)).toHaveValue('es');
  await timeout.context().close();
  report.checks.push('Missing, invalid, failing and timed-out country lookups keep the browser language without blocking the game.');

  const home = await fresh('es-ES', 320);
  await expect(language(home)).toHaveValue('es');
  assert.deepEqual((await language(home).locator('option').evaluateAll(options => options.map(option => option.value))).sort(), [...languages].sort());
  const buttonLabels = {};
  for (const locale of languages) {
    await choose(home, locale);
    buttonLabels[locale] = (await home.getByTestId('create-room').textContent()).trim();
    assert.ok(buttonLabels[locale], `${locale} must have a create-table translation.`);
    if (locale !== 'sl') assert.notEqual(buttonLabels[locale], buttonLabels.sl, `${locale} must not use the Slovenian fallback.`);
    await noOverflow(home, `${locale} home at 320px`);
  }
  await choose(home, 'de');
  await home.reload();
  await expect(language(home)).toHaveValue('de');
  await expect(home.locator('html')).toHaveAttribute('lang', 'de');
  await home.context().close();
  report.checks.push({ languages: buttonLabels, preferencePersistsOnReload: true, homeWidth: 320 });

  const a = await fresh('en-GB');
  const b = await fresh('es-MX');
  await expect(language(a)).toHaveValue('en');
  await expect(language(b)).toHaveValue('es');
  await a.getByTestId('player-name').fill('Ana');
  await a.getByTestId('create-room').click();
  await expect(a.getByTestId('room-code')).toBeVisible();
  await expect(language(a)).toBeVisible();
  await expect(a.getByTestId('game-settings')).toHaveCount(0);
  const roomId = (await a.getByTestId('room-code').textContent()).trim();
  const invitation = await a.locator('.invite-url').inputValue();
  await b.goto(invitation);
  await b.getByTestId('player-name').fill('Luis');
  await b.getByTestId('join-room').click();
  await Promise.all([a, b].map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', 'bidding')));
  await expect(a.locator('html')).toHaveAttribute('lang', 'en');
  await expect(b.locator('html')).toHaveAttribute('lang', 'es');
  const savePath = path.join(dataDir, `${roomId}.json`);
  const savedBefore = await readFile(savePath, 'utf8');
  const boardBefore = await board(a);

  const kingLabels = [];
  for (const [index, page] of [a, b].entries()) {
    await page.locator('.header-rules').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    assert.notEqual(await page.getByRole('dialog').getAttribute('aria-label'), 'Kako igrati');
    await noOverflow(page, `Player ${index} rules`);
    await closeDialog(page);
    await page.getByTestId('deck-gallery').click();
    const king = page.getByRole('dialog').locator('[data-card-id="clubs-8"]');
    await expect(king).toHaveCount(1);
    kingLabels.push(await king.getAttribute('aria-label'));
    assert.ok(kingLabels.at(-1) && kingLabels.at(-1) !== 'Kralj križa');
    await noOverflow(page, `Player ${index} deck`);
    await closeDialog(page);
    await page.locator('.score-button').click();
    await expect(page.getByTestId('scoreboard-row')).toHaveCount(1);
    await page.getByTestId('score-details').locator('summary').click();
    assert.ok(!(await page.getByRole('dialog').innerText()).includes('Napovedana igra: uspešna napoved.'));
    await noOverflow(page, `Player ${index} score calculation`);
    await page.screenshot({ path: path.join(artifacts, `score-${index === 0 ? 'en' : 'es'}.png`), fullPage: true });
    await closeDialog(page);
  }
  assert.notEqual(kingLabels[0], kingLabels[1], 'Card accessibility labels must use each player’s language.');
  await a.setViewportSize({ width: 320, height: 844 });
  await openSettings(a);
  const gear = await a.getByTestId('game-settings').boundingBox();
  assert.ok(gear.width >= 44 && gear.height >= 44, 'Game settings keeps a 44px touch target.');
  await noOverflow(a, 'English game settings at 320px');
  await a.screenshot({ path: path.join(artifacts, 'settings-en-320.png'), fullPage: true, animations: 'disabled' });
  await a.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await expect(a.getByTestId('game-settings')).toBeFocused();
  assert.deepEqual(await board(a), boardBefore, 'Opening and closing settings must preserve game state.');
  for (const locale of languages) {
    await choose(a, locale);
    await a.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await noOverflow(a, `${locale} live table at 320px`);
    assert.deepEqual(await board(a), boardBefore, `${locale}: language switching must preserve game state.`);
  }
  await expectGameLanguage(b, 'es');
  assert.equal(await readFile(savePath, 'utf8'), savedBefore, 'Language switching and reading dialogs must not mutate the saved game.');
  await choose(a, 'en');
  await b.setViewportSize({ width: 320, height: 844 });
  for (const [page, locale] of [[a, 'en'], [b, 'es']]) {
    await noOverflow(page, `${locale} table screenshot`);
    await page.screenshot({ path: path.join(artifacts, `table-${locale}-320.png`), fullPage: true });
  }
  report.checks.push('Two players keep separate languages; card names, rules and saved score calculations translate without changing game state.');
  report.checks.push('All 12 languages fit the live table at 320px without changing game state.');
  report.checks.push('Game language selection opens from a 44px settings button; all 12 languages fit settings at 320px and dismiss by Close or Escape with focus restored. Home and waiting screens retain the flag selector.');

  for (let count = 0; count < 2; count++) {
    const states = await Promise.all([a, b].map(board));
    const index = states.findIndex(state => state.turn === state.you);
    await [a, b][index].getByTestId('bid-pass').click();
    if (count === 0) await expect([a, b][1 - index].getByTestId('bid-pass')).toBeVisible();
  }
  await Promise.all([a, b].map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', 'playing')));
  for (let count = 0; count < 2; count++) {
    const states = await Promise.all([a, b].map(board));
    const index = states.findIndex(state => state.turn === state.you);
    await [a, b][index].locator('[data-testid="play-card"]:enabled').first().click();
    if (count === 0) await expect([a, b][1 - index].locator('[data-testid="play-card"]:enabled').first()).toBeVisible();
  }
  await Promise.all([a, b].map(page => expect(page.locator('.game-page')).toHaveAttribute('data-trick-number', '2')));
  const playedBefore = await board(b);
  const playedSave = await readFile(savePath, 'utf8');
  await choose(b, 'hu');
  assert.deepEqual(await board(b), playedBefore);
  await b.reload();
  await expect(b.locator('.game-page')).toHaveAttribute('data-trick-number', '2');
  await expectGameLanguage(b, 'hu');
  assert.equal(await readFile(savePath, 'utf8'), playedSave, 'Changing the language and reconnecting must preserve cards and scores.');
  await choose(b, 'es');
  report.checks.push('Players can bid and play across languages; changing language during a round survives reload and preserves cards and scores.');

  // A real server-generated error, rather than a translated client-only string.
  const invalid = await fresh('es-ES');
  await invalid.goto(`${origin}/#invite=${'x'.repeat(43)}&room=ABC234`);
  await invalid.getByTestId('player-name').fill('Invitado');
  await invalid.getByTestId('join-room').click();
  await expect(invalid.getByRole('alert')).toBeVisible();
  const spanishError = await invalid.getByRole('alert').innerText();
  assert.ok(spanishError && !spanishError.includes('Povabilo ni veljavno'));
  await choose(invalid, 'en');
  const englishError = await invalid.getByRole('alert').innerText();
  assert.notEqual(englishError, spanishError, 'An existing server error must update when the language changes.');
  assert.match(englishError, /invitation/i);
  await invalid.context().close();
  report.checks.push({ localizedServerError: { es: spanishError, en: englishError } });
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
  console.log('Language browser checks passed: 12 languages, game settings, IP/browser defaults, explicit-choice races, lookup timeouts, persistence, mixed-language play, dialogs, accessible card names and server errors.');
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await server?.close();
  await rm(dataDir, { recursive: true, force: true });
}
