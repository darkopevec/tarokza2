import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { hash } from '../server/identity.mjs';
import { createGame } from '../shared/game.mjs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-browser-identity-'));
const legacyToken = randomBytes(32).toString('base64url');
await writeFile(path.join(dataDir, 'ABC234.json'), JSON.stringify({ version: 1, id: 'ABC234', createdAt: '2026-01-01', updatedAt: '2026-01-01', players: [{ id: 'legacy-seat', name: 'Stari igralec', tokenHash: hash(legacyToken) }], game: null }));
const conflictTokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
const conflictSeats = ['Stara Ana', 'Stari Luka'].map((name, index) => ({ id: `old-${index}`, name, tokenHash: hash(conflictTokens[index]) }));
await writeFile(path.join(dataDir, 'CDE234.json'), JSON.stringify({ version: 1, id: 'CDE234', createdAt: '2026-01-01', updatedAt: '2026-01-01', players: conflictSeats, game: createGame({ playerIds: conflictSeats.map(s => s.id), names: conflictSeats.map(s => s.name) }) }));
const server = await createTarokServer({ dataDir });
const address = await server.listen(0, '127.0.0.1');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
const contexts = [];
const errors = [];
const fresh = async () => {
  const ctx = await browser.newContext({ locale: 'sl-SI', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); contexts.push(ctx);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin); return page;
};
const openDevices = async page => {
  if (await page.locator('.game-page').count()) {
    await page.getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Naprave in obnovitev', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
};
const close = page => page.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
await mkdir('artifacts/identity', { recursive: true });
try {
  const a = await fresh();
  await a.getByTestId('player-name').fill('Ana'); await a.getByTestId('create-room').click();
  await expect(a.getByTestId('room-code')).toBeVisible();
  const invitation = await a.getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue();
  await expect(a.getByAltText('QR: Povabilo za prijatelja')).toBeVisible();
  await a.screenshot({ path: 'artifacts/identity/invitation.png', fullPage: true });
  const b = await fresh(); await b.goto(invitation);
  await expect(b.getByTestId('join-room')).toBeVisible();
  assert.equal(new URL(b.url()).hash, '');
  await b.reload(); await expect(b.getByTestId('join-room')).toBeVisible();
  await b.getByTestId('player-name').fill('Luka'); await b.getByTestId('join-room').click();
  await expect(a.locator('.game-page')).toBeVisible(); await expect(b.locator('.game-page')).toBeVisible();
  await b.context().setOffline(true);
  await expect(b.getByText('Povezovanje …', { exact: true })).toBeVisible();
  await b.context().setOffline(false);
  await expect(b.getByText('Pripravljeno na igro', { exact: true })).toBeVisible();
  // A reconnect must restore the seat, not merely the online indicator.
  const aFirst = await a.getByTestId('bid-pass').count();
  if (aFirst) await a.getByTestId('bid-pass').click();
  await b.getByTestId('bid-pass').click();
  if (!aFirst) await a.getByTestId('bid-pass').click();
  await expect(b.locator('.game-page')).toHaveAttribute('data-phase', 'playing');
  await b.getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
  await expect(b.getByRole('heading', { name: 'Moje mize' })).toBeVisible();
  await b.getByRole('button', { name: 'Nadaljuj' }).click();
  await expect(b.locator('.game-page')).toBeVisible();

  await openDevices(a); await a.getByRole('button', { name: 'Dodaj novo napravo', exact: true }).click();
  const deviceLink = await a.getByRole('textbox', { name: 'Povezava za novo napravo', exact: true }).inputValue();
  await expect(a.getByAltText('QR: Povezava za novo napravo')).toBeVisible();
  await a.screenshot({ path: 'artifacts/identity/devices.png', fullPage: true });
  const d = await fresh(); await d.goto(deviceLink); await d.getByRole('button', { name: 'Poveži brskalnik' }).click();
  await expect(d.getByRole('heading', { name: 'Moje mize' })).toBeVisible();
  await expect(d.getByText('Luka', { exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Nadaljuj' }).click(); await expect(d.locator('.game-page')).toBeVisible();
  const credential = await d.evaluate(() => localStorage.getItem('tarokza2.device'));
  assert.notEqual(credential, await a.evaluate(() => localStorage.getItem('tarokza2.device')));
  await d.reload(); await expect(d.locator('.game-page')).toBeVisible();
  await a.getByRole('button', { name: 'Ustvari novo obnovitveno povezavo' }).click();
  const recovery = await a.getByRole('textbox', { name: 'Zasebna obnovitvena povezava', exact: true }).inputValue();
  const r = await fresh(); await r.goto(recovery); await r.getByRole('button', { name: 'Poveži brskalnik' }).click();
  await expect(r.getByRole('heading', { name: 'Moje mize' })).toBeVisible();
  await r.setViewportSize({ width: 320, height: 568 });
  assert.equal(await r.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await r.screenshot({ path: 'artifacts/identity/my-tables-320.png', fullPage: true });
  // Existing other identity is preserved, including on same-document hash navigation.
  await b.goto(origin); await expect(b.getByRole('heading', { name: 'Moje mize' })).toBeVisible();
  const before = await b.evaluate(() => localStorage.getItem('tarokza2.device'));
  await b.goto(recovery); await b.getByRole('button', { name: 'Poveži brskalnik' }).click();
  await expect(b.getByRole('alert')).toContainText('drugemu igralcu');
  assert.equal(await b.evaluate(() => localStorage.getItem('tarokza2.device')), before);
  await close(a); await openDevices(a);
  await a.getByRole('button', { name: 'Odstrani', exact: true }).first().click();
  await expect(d.getByRole('alert')).toContainText('odstranjen');
  assert.equal(await d.evaluate(() => localStorage.getItem('tarokza2.device')), null);
  // A revoked browser can immediately use recovery without manually reloading.
  await d.goto(recovery); await d.getByRole('button', { name: 'Poveži brskalnik' }).click();
  await expect(d.getByRole('heading', { name: 'Moje mize' })).toBeVisible();
  const old = await fresh();
  await old.evaluate(token => {
    localStorage.setItem('tarokza2.sessions', JSON.stringify({ ABC234: { roomId: 'ABC234', token } }));
    localStorage.setItem('tarokza2.name', JSON.stringify('Stari igralec'));
  }, legacyToken);
  await old.reload();
  await expect(old.getByText('ABC234 · Povabi prijatelja')).toBeVisible();
  assert.deepEqual(await old.evaluate(() => JSON.parse(localStorage.getItem('tarokza2.sessions'))), {});
  await old.getByRole('button', { name: 'Nadaljuj' }).click();
  await expect(old.getByTestId('room-code')).toHaveText('ABC234');
  const conflict = await fresh();
  await conflict.evaluate(tokens => {
    localStorage.setItem('tarokza2.sessions', JSON.stringify({ CDE234: { roomId: 'CDE234', token: tokens[0] } }));
    localStorage.setItem('tarokza2.session', JSON.stringify({ roomId: 'CDE234', token: tokens[1] }));
    localStorage.setItem('tarokza2.name', JSON.stringify('Stara Ana'));
  }, conflictTokens);
  await conflict.reload();
  await expect(conflict.getByRole('button', { name: 'Miza CDE234 · Stara Ana' })).toBeVisible();
  await expect(conflict.getByRole('button', { name: 'Miza CDE234 · Stari Luka' })).toBeVisible();
  await expect(conflict.getByRole('button', { name: 'Nadaljuj' })).toHaveCount(0);
  await conflict.getByRole('button', { name: 'Miza CDE234 · Stara Ana' }).click();
  await expect(conflict.getByRole('button', { name: 'Nadaljuj' })).toHaveCount(1);
  assert.equal(await conflict.evaluate(() => JSON.parse(localStorage.getItem('tarokza2.session')).token), conflictTokens[1]);
  // Two tabs creating tables at once share one device/player identity.
  const tabOne = await fresh();
  const tabTwo = await tabOne.context().newPage(); await tabTwo.goto(origin);
  await tabOne.getByTestId('player-name').fill('Skupni igralec');
  await tabTwo.getByTestId('player-name').fill('Skupni igralec');
  await Promise.all([tabOne, tabTwo].map(p => p.getByTestId('create-room').click()));
  for (const p of [tabOne, tabTwo]) await expect(p.getByTestId('room-code')).toBeVisible();
  await tabOne.goto(origin);
  await expect(tabOne.getByRole('button', { name: 'Nadaljuj' })).toHaveCount(2);
  for (let i = 0; i < 4; i++) {
    await tabOne.getByTestId('create-room').click();
    await expect(tabOne.getByTestId('room-code')).toBeVisible();
    await tabOne.goto(origin);
    await expect(tabOne.getByRole('heading', { name: 'Moje mize' })).toBeVisible();
  }
  await tabOne.setViewportSize({ width: 320, height: 568 });
  await expect(tabOne.getByRole('button', { name: 'Nadaljuj' })).toHaveCount(6);
  const lastTable = tabOne.getByRole('button', { name: 'Nadaljuj' }).last();
  await lastTable.scrollIntoViewIfNeeded();
  assert.ok((await lastTable.boundingBox()).height >= 44, 'Long table lists retain readable touch targets.');
  await tabOne.screenshot({ path: 'artifacts/identity/long-table-list.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Identity browser checks passed: invites, QR, refresh, device linking, recovery, conflict, revocation, 320px layout, legacy migration and conflicting seats, concurrent tabs, offline reconnect.');
} finally { await browser.close(); await server.close(); await rm(dataDir, { recursive: true, force: true }); }
