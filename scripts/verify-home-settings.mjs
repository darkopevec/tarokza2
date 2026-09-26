// Verify the shared header and Settings using disposable local players and rooms.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';

const locales = ['sl', 'en', 'es', 'de', 'fr', 'it', 'cs', 'sk', 'hu', 'da', 'ro', 'pl'];
const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/home-settings');
const report = { checks: [], layouts: [], browserErrors: [], passed: false };
const pages = [];
let dataDir, server, browser, origin;
const gear = page => page.getByTestId('game-settings');
const settings = page => page.locator('.game-settings-modal');
const deck = page => page.getByTestId('settings-deck-select');
const language = page => page.getByTestId('language-select');
const name = page => page.getByTestId('settings-player-name');
const row = (page, roomId) => page.locator('.identity-table-row').filter({ hasText: roomId });
const savedRoom = roomId => readFile(path.join(dataDir, `${roomId}.json`), 'utf8');

function observe(page) {
  page.setDefaultTimeout(10_000);
  page.on('pageerror', failure => report.browserErrors.push(failure.message));
  pages.push(page);
  return page;
}
async function fresh() {
  const context = await browser.newContext({ locale: 'sl-SI',
    viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('tarokza2.language', 'sl'));
  const page = observe(await context.newPage());
  await page.goto(origin);
  await expect(gear(page)).toBeVisible();
  return page;
}
async function open(page, authenticated) {
  await expect(language(page)).toHaveCount(0);
  await gear(page).click();
  await expect(settings(page)).toBeVisible();
  await expect(deck(page)).toBeVisible();
  await expect(language(page)).toBeVisible();
  await expect(name(page)).toHaveCount(authenticated ? 1 : 0);
  await expect(page.getByTestId('settings-devices')).toHaveCount(authenticated ? 1 : 0);
  assert.deepEqual(await settings(page).locator('[data-testid]').evaluateAll(elements => elements
    .map(element => element.dataset.testid).filter(id => ['settings-deck-select', 'settings-player-name', 'language-select', 'settings-devices'].includes(id))),
  authenticated ? ['settings-deck-select', 'settings-player-name', 'language-select', 'settings-devices'] : ['settings-deck-select', 'language-select'],
  'Settings show card preferences first, then name, language and devices');
  await expect(gear(page)).toHaveAttribute('aria-expanded', 'true');
}
async function close(page) {
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(gear(page)).toBeFocused();
  await expect(gear(page)).toHaveAttribute('aria-expanded', 'false');
}
async function screenshot(page, filename) {
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true, animations: 'disabled' });
}
async function inspect(page, label, modal = false) {
  await page.evaluate(() => document.fonts.ready);
  if (modal) await settings(page).evaluate(element => { element.scrollTop = 0; });
  const value = await page.evaluate(modal => {
    const box = element => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const status = document.querySelector('.connection-status');
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      logo: box(document.querySelector('.site-header .logo')),
      wordmark: getComputedStyle(document.querySelector('.logo > span:last-child')).display,
      status: { ...box(status), text: status.textContent.trim(), title: status.title,
        role: status.getAttribute('role'), byLogo: !!status.closest('.header-brand'),
        inActions: !!status.closest('.header-right') },
      actions: box(document.querySelector('.header-right')),
      controls: [...document.querySelectorAll(modal ? '.game-settings-modal button, .game-settings-modal input, .game-settings-modal select' : '.site-header button')]
        .filter(element => element.getClientRects().length).map(element => ({
          label: element.getAttribute('aria-label') || element.textContent.trim(), ...box(element),
        })),
    };
  }, modal);
  assert.ok(value.documentWidth <= value.width + 1, `${label}: no horizontal page overflow`);
  assert.notEqual(value.wordmark, 'none', `${label}: the tarokza2 wordmark stays visible`);
  assert.equal(value.status.byLogo, true, `${label}: connection status is grouped with the logo`);
  assert.equal(value.status.inActions, false, `${label}: actions contain no stray connection indicator`);
  assert.equal(value.status.role, 'status');
  assert.ok(value.status.text && value.status.title === value.status.text, `${label}: connection state has accessible text and a matching tooltip`);
  assert.ok(value.status.left >= value.logo.right - 1 && value.status.left - value.logo.right <= 16,
    `${label}: the connection indicator sits immediately after the logo`);
  assert.ok(value.status.right <= value.actions.left + 1, `${label}: branding and actions do not overlap`);
  for (const control of value.controls) {
    assert.ok(control.left >= -1 && control.right <= value.width + 1, `${label}: ${control.label} fits the viewport`);
    assert.ok(control.width >= 43.5 && control.height >= 43.5, `${label}: ${control.label} has a 44px target`);
  }
  for (let i = 0; i < value.controls.length; i++) for (let j = i + 1; j < value.controls.length; j++) {
    const a = value.controls[i], b = value.controls[j];
    assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 ||
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, `${label}: controls do not overlap`);
  }
  report.layouts.push({ label, ...value });
}

await mkdir(artifacts, { recursive: true });
try {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-home-settings-'));
  server = await createTarokServer({ dataDir });
  const address = await server.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const host = await fresh();
  await expect(host.locator('.connection-status')).toHaveText('Pripravljeno na igro');
  for (const width of [320, 390, 1280]) {
    await host.setViewportSize({ width, height: width === 320 ? 568 : 800 });
    await inspect(host, `guest header ${width}px`);
    await open(host, false);
    for (const locale of locales) {
      await language(host).selectOption(locale);
      await expect(host.locator('html')).toHaveAttribute('lang', locale);
      await inspect(host, `guest settings ${locale} ${width}px`, true);
    }
    await language(host).selectOption('sl');
    if (width === 320) await screenshot(host, 'guest-settings-320.png');
    await close(host);
  }
  assert.equal(await host.evaluate(() => localStorage.getItem('tarokza2.device')), null);
  assert.equal(await host.evaluate(() => localStorage.getItem('tarokza2.pending-device')), null);
  await assert.rejects(readFile(path.join(dataDir, 'identities.json')), { code: 'ENOENT' });
  await open(host, false);
  assert.deepEqual(await deck(host).locator('option').evaluateAll(options => options.map(option => option.value)),
    ['modiano', 'slovenian', 'smrekar']);
  for (const choice of ['modiano', 'slovenian', 'smrekar']) {
    await deck(host).selectOption(choice);
    assert.equal(await host.evaluate(() => localStorage.getItem('tarokza2.deck')), choice);
    await close(host);
    await host.getByTestId('deck-gallery').click();
    await expect(host.getByTestId('deck-select')).toHaveValue(choice);
    await host.keyboard.press('Escape');
    await open(host, false);
    await expect(deck(host)).toHaveValue(choice);
  }
  await close(host);
  await host.reload();
  await open(host, false);
  await expect(deck(host)).toHaveValue('smrekar');
  await close(host);
  assert.equal(await host.evaluate(() => localStorage.getItem('tarokza2.device')), null);
  await assert.rejects(readFile(path.join(dataDir, 'identities.json')), { code: 'ENOENT' });
  report.checks.push('Guest Settings shows card preferences then language, supports all 12 locales at 320/390/1280px, restores focus on Escape, and never creates an identity.');
  report.checks.push('All three deck preferences update the existing card gallery and persist after reload.');

  await host.setViewportSize({ width: 320, height: 568 });
  await host.context().setOffline(true);
  await expect(host.locator('.connection-status')).toHaveClass(/disconnected/);
  await expect(host.locator('.connection-status')).toHaveText('Povezovanje …');
  await inspect(host, 'offline guest header 320px');
  await open(host, false);
  await language(host).selectOption('en');
  await expect(host.locator('.connection-status')).not.toHaveText('Povezovanje …');
  await language(host).selectOption('sl');
  await close(host);
  await screenshot(host, 'offline-header-320.png');
  await host.context().setOffline(false);
  await expect(host.locator('.connection-status')).toHaveText('Pripravljeno na igro');
  report.checks.push('Online and offline indicators remain beside the logo, with localized accessible status and tooltip; offline guests can still change language.');

  await host.getByTestId('player-name').fill('Ana');
  await host.getByTestId('create-room').click();
  await expect(host.getByTestId('room-code')).toBeVisible();
  const roomId = (await host.getByTestId('room-code').textContent()).trim();
  const invitation = await host.getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue();
  const waitingBefore = await savedRoom(roomId);
  await open(host, true);
  await name(host).fill('Ana Čaka');
  await host.getByTestId('save-player-name').click();
  await expect(host.getByTestId('name-save-status')).toHaveText('Ime je shranjeno.');
  await inspect(host, 'waiting settings 320px', true);
  await screenshot(host, 'waiting-settings-320.png');
  await close(host);
  assert.equal(await host.getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue(), invitation);
  assert.equal(await savedRoom(roomId), waitingBefore, 'Waiting settings preserve the invitation and saved room');
  report.checks.push('Waiting-room Settings changes the name while preserving the existing invitation and saved room.');

  await host.getByRole('button', { name: 'Naprave in obnovitev', exact: true }).click();
  await host.getByRole('button', { name: 'Dodaj novo napravo', exact: true }).click();
  const deviceLink = await host.getByRole('textbox', { name: 'Povezava za novo napravo', exact: true }).inputValue();
  const linked = await fresh();
  await linked.goto(deviceLink);
  await linked.getByRole('button', { name: 'Poveži brskalnik', exact: true }).click();
  await expect(linked.locator('.identity-toolbar')).toContainText('Igraš kot Ana Čaka.');
  assert.notEqual(await linked.evaluate(() => localStorage.getItem('tarokza2.device')),
    await host.evaluate(() => localStorage.getItem('tarokza2.device')));
  await host.keyboard.press('Escape');

  const guest = await fresh();
  await guest.goto(invitation);
  const pendingInvite = await guest.evaluate(() => sessionStorage.getItem('tarokza2.link'));
  await open(guest, false);
  await close(guest);
  assert.equal(await guest.evaluate(() => sessionStorage.getItem('tarokza2.link')), pendingInvite);
  await guest.getByTestId('player-name').fill('Luka');
  await guest.getByTestId('join-room').click();
  await expect(host.locator('.game-page')).toBeVisible();
  await expect(guest.locator('.game-page')).toBeVisible();
  const activeBefore = await savedRoom(roomId);
  const gameUrl = host.url();
  await open(host, true);
  await expect(name(host)).toHaveValue('Ana Čaka');
  await inspect(host, 'game settings 320px', true);
  await name(host).fill('Draft preserved');
  await host.getByTestId('settings-devices').click();
  await expect(host.getByTestId('settings-back')).toBeVisible();
  await expect(host.getByTestId('settings-back')).toBeFocused();
  await expect(host.getByRole('dialog')).toHaveCount(1);
  await expect(gear(host)).toHaveAttribute('aria-expanded', 'true');
  await expect(host.getByRole('button', { name: 'Dodaj novo napravo', exact: true })).toBeVisible();
  await expect(host.getByRole('button', { name: 'Ustvari novo obnovitveno povezavo', exact: true })).toBeVisible();
  await expect(host.locator('.game-page')).toBeVisible();
  assert.equal(host.url(), gameUrl, 'Device settings do not leave the current table');
  await screenshot(host, 'game-devices-320.png');
  await host.context().setOffline(true);
  await expect(host.locator('.connection-status')).toHaveClass(/disconnected/);
  const deviceInputs = settings(host).locator('.identity-settings input:not([readonly])');
  assert.ok(await deviceInputs.count(), 'The device list includes editable device names');
  for (const field of await deviceInputs.all()) await expect(field).toBeDisabled();
  await expect(host.getByRole('button', { name: 'Dodaj novo napravo', exact: true })).toBeDisabled();
  await expect(host.getByRole('button', { name: 'Ustvari novo obnovitveno povezavo', exact: true })).toBeDisabled();
  await host.context().setOffline(false);
  await expect(host.locator('.connection-status')).not.toHaveClass(/disconnected/);
  for (const field of await deviceInputs.all()) await expect(field).toBeEnabled();
  await host.getByTestId('settings-back').click();
  await expect(host.getByTestId('settings-devices')).toBeFocused();
  await expect(name(host)).toHaveValue('Draft preserved');
  await close(host);
  await open(host, true);
  await expect(name(host)).toHaveValue('Ana Čaka');
  await host.getByTestId('settings-devices').click();
  await expect(host.getByTestId('settings-back')).toBeVisible();
  await close(host);
  assert.equal(host.url(), gameUrl);
  assert.equal(await savedRoom(roomId), activeBefore);
  report.checks.push('Devices and recovery open within a single Settings dialog during play; offline mutations disable, Back preserves an unsaved name and restores focus, and Escape leaves the table intact.');

  const home = observe(await host.context().newPage());
  await home.goto(origin);
  await expect(home.locator('.identity-toolbar')).toContainText('Igraš kot Ana Čaka.');
  const guestHome = observe(await guest.context().newPage());
  await guestHome.goto(origin);
  await expect(row(guestHome, roomId).locator('strong')).toHaveText('Ana Čaka');
  await open(linked, true);
  await open(home, true);
  await name(home).fill('Ana Doma');
  await home.getByTestId('save-player-name').click();
  await expect(home.getByTestId('name-save-status')).toHaveText('Ime je shranjeno.');
  await expect(name(linked)).toHaveValue('Ana Doma');
  await expect(linked.locator('.identity-toolbar')).toContainText('Igraš kot Ana Doma.');
  await expect(guest.locator('.opponent-name strong')).toHaveText('Ana Doma');
  await expect(row(guestHome, roomId).locator('strong')).toHaveText('Ana Doma');
  await expect(host.locator('.hand-identity strong')).toContainText('Ana Doma');
  for (const width of [320, 390, 1280]) {
    await home.setViewportSize({ width, height: width === 320 ? 568 : 800 });
    for (const locale of locales) {
      await language(home).selectOption(locale);
      await inspect(home, `authenticated settings ${locale} ${width}px`, true);
    }
    await language(home).selectOption('sl');
    if (width === 320) await screenshot(home, 'home-settings-320.png');
  }
  await close(home);
  await home.setViewportSize({ width: 320, height: 568 });
  await inspect(home, 'authenticated home header 320px');
  await screenshot(home, 'home-header-320.png');
  await home.reload();
  await open(home, true);
  await expect(name(home)).toHaveValue('Ana Doma');
  assert.equal(await savedRoom(roomId), activeBefore, 'Shared Settings leave the full saved game, cards, scores and revision unchanged');
  report.checks.push('Home Settings changes the name across a genuinely linked device, live opponents, player labels and table lists; reload retains it.');
  report.checks.push('Authenticated Settings fits all 12 locales at 320/390/1280px with 44px targets; game and invitation data remain unchanged.');
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
  console.log('PASS: shared guest/home/waiting/game Settings, linked-name sync, 12 locales, mobile/desktop layout, accessible status beside logo, offline behavior and preserved games/invitations.');
} catch (failure) {
  report.error = { message: failure.message, stack: failure.stack };
  process.exitCode = 1;
  console.error(failure.stack);
  if (pages[0]) await screenshot(pages[0], 'failure.png').catch(() => {});
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
