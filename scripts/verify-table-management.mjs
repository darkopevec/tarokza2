// Exercise per-player archives against a disposable local server only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/table-management');
const report = { cases: [], layouts: [], screenshots: [], browserErrors: [] };
const pages = [];
let dataDir, server, browser, origin;

function observe(page) {
  page.setDefaultTimeout(12_000);
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

async function tab(page) {
  const sibling = observe(await page.context().newPage());
  await sibling.goto(origin);
  await expectHome(sibling);
  return sibling;
}

const row = (page, roomId) => page.locator('.identity-tables .identity-table-row').filter({ hasText: roomId });
const archivedRow = (page, roomId) => page.locator('.identity-archive').getByTestId('archived-table').filter({ hasText: roomId });
const pendingRow = (page, roomId) => page.locator('.identity-archive').getByTestId('pending-table').filter({ hasText: roomId });
const abandon = (page, roomId) => page.getByRole('button', { name: `Opusti mizo ${roomId}`, exact: true });
const dispositionDialog = page => page.locator('.table-disposition-modal');
const snapshot = async roomId => JSON.parse(await readFile(path.join(dataDir, `${roomId}.json`), 'utf8'));

async function expectHome(page) {
  await expect(page.getByRole('heading', { name: 'Moje mize', exact: true })).toBeVisible();
  await expect(page.locator('.game-page, .waiting-page')).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.has('room'), false, 'Returning home clears the room URL');
}

async function leave(page) {
  await page.getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
  await expectHome(page);
}

async function createTable(page) {
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{6}$/);
  return {
    roomId: (await page.getByTestId('room-code').textContent()).trim(),
    invitation: await page.getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue(),
  };
}

async function join(host, guest, table) {
  await guest.goto(table.invitation);
  if (await guest.getByTestId('player-name').count()) await guest.getByTestId('player-name').fill('Luka Aleksander Novak');
  await guest.getByTestId('join-room').click();
  await expect(host.locator('.game-page')).toBeVisible();
  await expect(guest.locator('.game-page')).toBeVisible();
}

async function confirm(page, roomId) {
  await abandon(page, roomId).click();
  const dialog = page.getByRole('dialog', { name: 'Opustiš mizo?', exact: true });
  await expect(dialog).toContainText(`Miza ${roomId} bo zaprta za oba igralca`);
  await expect(dialog).toContainText('Igre ne bo mogoče nadaljevati.');
  await dialog.getByTestId('confirm-abandon').click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, roomId)).toHaveCount(0);
  await expectChoice(page, roomId);
}

async function expectChoice(page, roomId) {
  const dialog = dispositionDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(roomId);
  await expect(dialog.getByRole('heading')).toHaveText('Arhiviraj ali izbriši?');
  await expect(dialog.getByTestId('archive-table')).toBeEnabled();
  await expect(dialog.getByTestId('delete-table')).toBeEnabled();
}

async function choose(page, roomId, disposition) {
  await expectChoice(page, roomId);
  await dispositionDialog(page).getByTestId(disposition === 'archived' ? 'archive-table' : 'delete-table').click();
  await expect(dispositionDialog(page)).toHaveCount(0);
  await expect(pendingRow(page, roomId)).toHaveCount(0);
  if (disposition === 'archived') {
    await expect(archivedRow(page, roomId)).toBeVisible();
    await expect(archivedRow(page, roomId).getByTestId('delete-archived-table')).toBeVisible();
    await expect(archivedRow(page, roomId).getByTestId('choose-table-disposition')).toHaveCount(0);
  } else await expect(archivedRow(page, roomId)).toHaveCount(0);
}

async function deleteArchive(page, roomId) {
  await archivedRow(page, roomId).getByTestId('delete-archived-table').click();
  const dialog = page.locator('.delete-archive-modal');
  await expect(dialog).toContainText(roomId);
  await dialog.getByTestId('confirm-delete-archive').click();
  await expect(dialog).toHaveCount(0);
  await expect(archivedRow(page, roomId)).toHaveCount(0);
}

async function capture(page, filename) {
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true, animations: 'disabled' });
  report.screenshots.push(filename);
}

async function inspectLayout(page, label, dialogSelector = null) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(dialogSelector => {
    const bounds = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const selector = dialogSelector ? `${dialogSelector} button` : '.site-header button, .identity-home button';
    const controls = [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length)
      .map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim(),
        region: element.closest('.site-header') ? 'header' : 'content', ...bounds(element) }));
    const rows = [...document.querySelectorAll('.identity-tables .identity-table-row')].map(element => ({
      buttonCount: element.querySelectorAll('button').length,
      nestedButtons: element.querySelectorAll('button button, button [role="button"]').length,
    }));
    const archive = document.querySelector('.identity-archive');
    const active = document.querySelector('.identity-tables');
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, controls, rows,
      archiveBelowActive: !archive || !active || bounds(archive).top >= bounds(active).bottom,
      nestedArchiveButtons: archive?.querySelectorAll('button button, button [role="button"]').length || 0 };
  }, dialogSelector);
  report.layouts.push({ label, ...layout });
  assert.ok(layout.documentWidth <= layout.width + 1, `${label}: no horizontal page overflow`);
  assert.ok(layout.archiveBelowActive, `${label}: archive follows the active table list`);
  assert.equal(layout.nestedArchiveButtons, 0, `${label}: archive actions are not nested buttons`);
  assert.ok(layout.controls.length > 0, `${label}: actionable controls are present`);
  for (const control of layout.controls) {
    assert.ok(control.left >= -1 && control.right <= layout.width + 1, `${label}: ${control.label} fits the viewport`);
    assert.ok(control.width >= 43.5 && control.height >= 43.5,
      `${label}: ${control.label} keeps a 44px target (${control.width} × ${control.height})`);
  }
  for (let i = 0; i < layout.controls.length; i++) {
    for (let j = i + 1; j < layout.controls.length; j++) {
      const a = layout.controls[i], b = layout.controls[j];
      // The home list scrolls below the persistent header.
      if (a.region !== b.region) continue;
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      assert.ok(width <= 1 || height <= 1, `${label}: ${a.label} and ${b.label} do not overlap`);
    }
  }
  for (const table of layout.rows) {
    assert.equal(table.buttonCount, 2, `${label}: each table has separate resume and abandon actions`);
    assert.equal(table.nestedButtons, 0, `${label}: table actions are not nested buttons`);
  }
}

await mkdir(artifacts, { recursive: true });
try {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-table-management-'));
  server = await createTarokServer({ dataDir });
  const address = await server.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const host = await fresh();
  await host.getByTestId('player-name').fill('Ana Marija Novak');
  const preserved = await createTable(host);
  const preservedBefore = await snapshot(preserved.roomId);
  await leave(host);
  const waiting = await createTable(host);
  const waitingBefore = await snapshot(waiting.roomId);
  await leave(host);
  const active = await createTable(host);
  const guest = await fresh();
  await join(host, guest, active);
  // Reach actual play, so abandonment is verified with a saved game in progress.
  const hostBidsFirst = await host.getByTestId('bid-pass').count();
  if (hostBidsFirst) await host.getByTestId('bid-pass').click();
  await guest.getByTestId('bid-pass').click();
  if (!hostBidsFirst) await host.getByTestId('bid-pass').click();
  await expect(guest.locator('.game-page')).toHaveAttribute('data-phase', 'playing');
  const activeBefore = await snapshot(active.roomId);
  await leave(host);

  // Link a genuinely separate browser, then keep both same-player and opponent
  // tabs open to verify every identity's live table list receives the update.
  await host.getByRole('button', { name: 'Naprave in obnovitev', exact: true }).click();
  await host.getByRole('button', { name: 'Dodaj novo napravo', exact: true }).click();
  const deviceLink = await host.getByRole('textbox', { name: 'Povezava za novo napravo', exact: true }).inputValue();
  const linked = await fresh();
  await linked.goto(deviceLink);
  await linked.getByRole('button', { name: 'Poveži brskalnik', exact: true }).click();
  await expectHome(linked);
  assert.notEqual(await linked.evaluate(() => localStorage.getItem('tarokza2.device')),
    await host.evaluate(() => localStorage.getItem('tarokza2.device')), 'The linked browser uses its own device credential');
  await row(linked, active.roomId).locator('.identity-table-card').click();
  await expect(linked.locator('.game-page')).toBeVisible();
  const oldRoomUrl = linked.url();
  await host.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
  const hostTab = await tab(host);
  const guestTab = await tab(guest);

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await host.setViewportSize(viewport);
    await expect(host.getByTestId('abandon-table')).toHaveCount(3);
    await inspectLayout(host, `${viewport.width}px home`);
    await capture(host, `home-${viewport.width}.png`);
    await abandon(host, waiting.roomId).click();
    await expect(host.getByRole('dialog')).toContainText(waiting.roomId);
    await inspectLayout(host, `${viewport.width}px confirmation`, '.abandon-table-modal');
    await capture(host, `confirm-${viewport.width}.png`);
    await host.getByRole('dialog').getByRole('button', { name: 'Prekliči', exact: true }).click();
    await expect(row(host, waiting.roomId)).toBeVisible();
    assert.deepEqual(await snapshot(waiting.roomId), waitingBefore, 'Cancel does not change the saved table');
  }
  report.cases.push('320px and 390px home and confirmation layouts; cancellation preserves the table');

  await hostTab.getByRole('button', { name: 'Naprave in obnovitev', exact: true }).click();
  await expect(hostTab.getByRole('dialog', { name: 'Naprave in obnovitev', exact: true })).toBeVisible();
  await confirm(host, waiting.roomId);
  await expect(row(hostTab, waiting.roomId)).toHaveCount(0);
  await expect(dispositionDialog(hostTab)).toHaveCount(0);
  await hostTab.getByRole('dialog', { name: 'Naprave in obnovitev', exact: true })
    .getByRole('button', { name: 'Zapri', exact: true }).click();
  await expectChoice(hostTab, waiting.roomId);
  await expect(guest.locator('.game-page')).toBeVisible();
  await expect(linked.locator('.game-page')).toBeVisible();
  await expect(dispositionDialog(linked)).toHaveCount(0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await host.setViewportSize(viewport);
    await inspectLayout(host, `${viewport.width}px archive or delete choice`, '.table-disposition-modal');
    await capture(host, `disposition-${viewport.width}.png`);
  }
  await choose(host, waiting.roomId, 'archived');
  await expect(dispositionDialog(hostTab)).toHaveCount(0);
  await expect(archivedRow(hostTab, waiting.roomId).getByTestId('delete-archived-table')).toBeVisible();
  // A linked browser's archive updates while it keeps playing another table.
  await leave(linked);
  await expect(row(linked, waiting.roomId)).toHaveCount(0);
  await expect(archivedRow(linked, waiting.roomId).getByTestId('delete-archived-table')).toBeVisible();
  await expect(row(linked, preserved.roomId)).toBeVisible();
  await row(linked, active.roomId).locator('.identity-table-card').click();
  await expect(linked.locator('.game-page')).toBeVisible();
  assert.ok((await snapshot(waiting.roomId)).abandonedAt, 'Confirmed waiting table is persistently closed');
  report.cases.push('Waiting table moves into its owner archive across linked devices without interrupting another game');

  await confirm(host, active.roomId);
  for (const page of [guest, linked]) {
    await expectHome(page);
    await expect(page.getByRole('alert')).toContainText('Ta miza je opuščena.');
  }
  for (const page of [host, hostTab, linked, guest, guestTab]) {
    await expect(row(page, active.roomId)).toHaveCount(0);
    await expectChoice(page, active.roomId);
  }
  const activeAfter = await snapshot(active.roomId);
  assert.ok(activeAfter.abandonedAt, 'Confirmed active table is persistently closed');
  assert.deepEqual(activeAfter.game, activeBefore.game, 'Abandonment retains the saved game data');
  assert.deepEqual(activeAfter.players, activeBefore.players, 'Abandonment retains both saved seats');
  await choose(host, active.roomId, 'archived');
  for (const page of [hostTab, linked]) {
    await expect(dispositionDialog(page)).toHaveCount(0);
    await expect(archivedRow(page, active.roomId).getByTestId('delete-archived-table')).toBeVisible();
  }
  // The owner's archive choice cannot decide the opponent's disposition.
  for (const page of [guest, guestTab]) await expectChoice(page, active.roomId);
  await choose(guest, active.roomId, 'deleted');
  await expect(dispositionDialog(guestTab)).toHaveCount(0);
  await expect(archivedRow(guestTab, active.roomId)).toHaveCount(0);
  for (const page of [host, hostTab, linked]) await expect(archivedRow(page, active.roomId)).toBeVisible();
  report.cases.push('Both players independently choose archive or delete; each choice syncs only to their linked devices and tabs');

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await host.setViewportSize(viewport);
    await inspectLayout(host, `${viewport.width}px archive at bottom`);
    await capture(host, `archive-${viewport.width}.png`);
    await archivedRow(host, active.roomId).getByTestId('delete-archived-table').click();
    const dialog = host.locator('.delete-archive-modal');
    await expect(dialog).toContainText(active.roomId);
    await inspectLayout(host, `${viewport.width}px delete archive confirmation`, '.delete-archive-modal');
    await capture(host, `delete-archive-${viewport.width}.png`);
    await dialog.getByRole('button', { name: 'Prekliči', exact: true }).click();
    await expect(archivedRow(host, active.roomId).getByTestId('delete-archived-table')).toBeVisible();
  }
  report.cases.push('Archive list, archive/delete prompt, and delete confirmation fit 320px and 390px with 44px touch targets');

  await linked.goto(oldRoomUrl);
  await expectHome(linked);
  await expect(linked.getByRole('alert')).toContainText('Ta miza je opuščena.');
  await linked.reload();
  await expectHome(linked);
  await expect(row(linked, active.roomId)).toHaveCount(0);
  await expect(archivedRow(linked, active.roomId)).toBeVisible();
  await expect(dispositionDialog(linked)).toHaveCount(0);
  await guest.reload();
  await expectHome(guest);
  await expect(archivedRow(guest, active.roomId)).toHaveCount(0);
  await expect(dispositionDialog(guest)).toHaveCount(0);
  report.cases.push('An old room URL cannot resume an archived game; archive and deletion survive reload');

  const offlineTable = await createTable(host);
  await join(host, guest, offlineTable);
  await leave(host);
  await guest.context().setOffline(true);
  await expect(guest.getByText('Povezovanje …', { exact: true })).toBeVisible();
  await confirm(host, offlineTable.roomId);
  await choose(host, offlineTable.roomId, 'archived');
  await expect(guest.locator('.game-page')).toBeVisible();
  await guest.context().setOffline(false);
  await expectHome(guest);
  await expect(guest.getByRole('alert')).toContainText('Ta miza je opuščena.');
  for (const page of [host, hostTab, linked, guest, guestTab]) {
    await expect(row(page, offlineTable.roomId)).toHaveCount(0);
  }
  await expectChoice(guest, offlineTable.roomId);
  await guest.reload();
  await expectHome(guest);
  await expectChoice(guest, offlineTable.roomId);
  await dispositionDialog(guest).getByRole('button', { name: 'Zapri', exact: true }).click();
  await expect(dispositionDialog(guest)).toHaveCount(0);
  const pending = pendingRow(guest, offlineTable.roomId).getByTestId('choose-table-disposition');
  await expect(pending).toBeVisible();
  await expect(pendingRow(guest, offlineTable.roomId).locator('.identity-table-card')).toHaveCount(0);
  await pending.click();
  await expectChoice(guest, offlineTable.roomId);
  await choose(guest, offlineTable.roomId, 'archived');
  await expect(archivedRow(guestTab, offlineTable.roomId).getByTestId('delete-archived-table')).toBeVisible();
  report.cases.push('An offline opponent receives the choice on reconnect; unanswered choices survive reload and can be dismissed and reopened');

  // Both chose archive. Removing one player's copy must preserve the other.
  await deleteArchive(linked, offlineTable.roomId);
  for (const page of [host, hostTab, linked]) await expect(archivedRow(page, offlineTable.roomId)).toHaveCount(0);
  for (const page of [guest, guestTab]) {
    await expect(archivedRow(page, offlineTable.roomId).getByTestId('delete-archived-table')).toBeVisible();
  }
  await guest.reload();
  await expectHome(guest);
  await expect(archivedRow(guest, offlineTable.roomId).getByTestId('delete-archived-table')).toBeVisible();
  await linked.reload();
  await expectHome(linked);
  await expect(archivedRow(linked, offlineTable.roomId)).toHaveCount(0);
  await expect(dispositionDialog(linked)).toHaveCount(0);
  report.cases.push('Both can archive a table; later deletion by one player leaves the opponent archive intact after reload');

  await deleteArchive(host, active.roomId);
  for (const page of [host, hostTab, linked, guest, guestTab]) await expect(archivedRow(page, active.roomId)).toHaveCount(0);
  await guest.goto(oldRoomUrl);
  await expectHome(guest);
  await expect(guest.getByRole('alert')).toContainText('Ta miza je opuščena.');
  await expect(archivedRow(guest, active.roomId)).toHaveCount(0);
  await host.reload();
  await expectHome(host);
  await expect(archivedRow(host, active.roomId)).toHaveCount(0);
  await expect(dispositionDialog(host)).toHaveCount(0);
  report.cases.push('A table disappears from both lists when both players delete it, while its closed game cannot resume');

  assert.deepEqual(await snapshot(preserved.roomId), preservedBefore, 'An unrelated table is unchanged throughout');
  for (const page of [host, hostTab, linked]) await expect(row(page, preserved.roomId)).toBeVisible();
  await row(host, preserved.roomId).locator('.identity-table-card').click();
  await expect(host.getByTestId('room-code')).toHaveText(preserved.roomId);
  assert.deepEqual(await snapshot(preserved.roomId), preservedBefore, 'The unrelated table remains resumable');
  await expect(guest.locator('.identity-tables .identity-table-row')).toHaveCount(0);
  assert.deepEqual(report.browserErrors, []);
  report.cases.push('Unrelated waiting table remains unchanged and resumable');
  report.passed = true;
  console.log('Table management browser checks passed: independent archive/delete choices, linked devices and tabs, offline pending choices, archive deletion, mobile layouts, cancellation, old URLs, and unrelated saved games.');
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  await Promise.all(pages.map((page, index) => capture(page, `failure-${index}.png`).catch(() => {})));
  process.exitCode = 1;
  console.error(error.stack);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
