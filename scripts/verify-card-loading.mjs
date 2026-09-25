// Nonblocking loading and persistent artwork cache checks on disposable data.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';
import { createDeck } from '../shared/cards.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-images-'));
const server = await createTarokServer({ dataDir });
const address = await server.listen(0, '127.0.0.1');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
let release;
const delayed = new Promise(resolve => { release = resolve; });
try {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ locale: 'sl-SI', viewport: { width: 390, height: 844 } })));
  // Exercise the uncontrolled first-page path before activating the worker.
  await contexts[0].addInitScript(() => {
    window.enableCardWorker = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = () => Promise.reject(new Error('First-load fixture'));
  });
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const requests = [];
  await pages[0].route('**/cards/**', async route => {
    requests.push(new URL(route.request().url()).pathname);
    await delayed;
    await route.continue();
  });
  await pages[0].goto(origin);
  await pages[0].getByTestId('player-name').fill('Ana');
  await pages[0].getByTestId('create-room').click();
  await expect(pages[0].getByTestId('room-code')).toBeVisible();
  await expect(pages[0].getByTestId('card-loading')).toHaveCount(0);
  const room = await pages[0].getByTestId('room-code').textContent();
  const visible = await pages[0].locator('.playing-card img').evaluateAll(images => images.map(image => new URL(image.src).pathname));
  await pages[0].waitForTimeout(200);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(url => visible.includes(url)), 'Hidden artwork must wait behind displayed cards');
  const invitation = await pages[0].getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue();
  await pages[1].goto(invitation);
  await pages[1].getByTestId('player-name').fill('Luka');
  await pages[1].getByTestId('join-room').click();
  await expect(pages[0].locator('.game-page')).toHaveAttribute('data-phase', 'bidding');
  await expect(pages[0].getByTestId('card-loading')).toHaveCount(0);
  // Gameplay UI is present even with all card downloads still delayed.
  release();
  await expect.poll(() => pages[0].evaluate(async () => (await (await caches.open('tarok-card-art-v1')).keys()).length), { timeout: 30000 }).toBe(55);
  await pages[0].unroute('**/cards/**');
  await pages[0].evaluate(async () => {
    await window.enableCardWorker('/card-cache-sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  // Close the page to discard all in-memory preloads. A fresh tab must still
  // retrieve every card with the network unavailable, via the persistent cache.
  await pages[0].close();
  const fresh = await contexts[0].newPage();
  await fresh.goto(`${origin}/?room=${room}`);
  await expect(fresh.locator('.game-page')).toBeVisible();
  await contexts[0].setOffline(true);
  const urls = createDeck().map(card => card.image);
  const cached = await fresh.evaluate(async urls => {
    const results = [];
    for (const url of urls) {
      const response = await fetch(url).catch(error => { throw new Error(`${url}: ${error.message}`); });
      results.push(response.ok && response.headers.get('content-type')?.startsWith('image/'));
    }
    return results;
  }, urls);
  assert.ok(cached.every(Boolean), 'Every face survives page closure and unavailable network');
  assert.equal(await fresh.evaluate(() => fetch('/health').then(() => true, () => false)), false, 'Private/app endpoints must not be cached by the artwork worker');
  await contexts[0].setOffline(false);
  const cacheKeys = await fresh.evaluate(async () => (await (await caches.open('tarok-card-art-v1')).keys()).map(request => new URL(request.url).pathname));
  assert.equal(cacheKeys.length, 55);
  assert.ok(cacheKeys.every(url => url.startsWith('/cards/')));
  const response = await fetch(`${origin}${urls[0]}`);
  assert.match(response.headers.get('cache-control'), /max-age=31536000/);
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.deepEqual(errors, []);
  console.log('PASS: immediate table/game entry with delayed artwork, visible-card priority, complete background cache, offline artwork in a fresh tab, and no caching of game endpoints.');
} finally {
  release();
  await browser.close();
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
}
