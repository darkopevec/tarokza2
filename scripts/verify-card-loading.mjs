// Nonblocking loading and persistent artwork cache checks on disposable data.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';
import { CARD_DECKS, DEFAULT_DECK, cardBackImage, cardImageUrls } from '../src/decks.mjs';

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
  await expect.poll(() => pages[0].evaluate(async () => (await (await caches.open('tarok-card-art-v1')).keys()).length), { timeout: 30000 }).toBe(cardImageUrls(DEFAULT_DECK).length);
  await pages[0].unroute('**/cards/**');
  await pages[0].evaluate(async () => {
    await window.enableCardWorker('/card-cache-sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  const boardBefore = await pages[0].locator('.game-page').evaluate(game => ({
    state: { ...game.dataset },
    cards: [...game.querySelectorAll('[data-testid="play-card"]')].map(card => ({ id: card.dataset.cardId, disabled: card.disabled })),
  }));
  await pages[0].getByTestId('deck-gallery').click();
  await expect(pages[0].getByTestId('deck-select')).toHaveValue('modiano');
  const galleryFaces = pages[0].getByRole('dialog').locator('.card-face-image');
  for (const { id } of CARD_DECKS.filter(deck => deck.id !== DEFAULT_DECK)) {
    await pages[0].getByTestId('deck-select').selectOption(id);
    await expect(galleryFaces).toHaveCount(54);
    const expected = cardImageUrls(id).slice(1).map(url => url.split('?')[0]).sort();
    await expect.poll(() => galleryFaces.evaluateAll(images => images.map(image => new URL(image.src).pathname).sort())).toEqual(expected);
    const galleryImages = await galleryFaces.evaluateAll(async images => {
      await Promise.all(images.map(image => image.decode()));
      return images.map(image => ({ path: new URL(image.src).pathname, loaded: image.complete && image.naturalWidth > 0 }));
    });
    assert.ok(galleryImages.every(image => image.loaded));
    assert.equal(galleryImages.filter(image => image.path.endsWith('.svg')).length,
      { slovenian: 16, smrekar: 13 }[id], `${id}: all reconstructed pip faces decode`);
    const deckUrls = cardImageUrls(id);
    await expect.poll(() => pages[0].evaluate(async urls => {
      const cache = await caches.open('tarok-card-art-v1');
      return (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
    }, deckUrls), { timeout: 30000 }).toBe(true);
  }
  await pages[0].getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
  const boardAfter = await pages[0].locator('.game-page').evaluate(game => ({
    state: { ...game.dataset },
    cards: [...game.querySelectorAll('[data-testid="play-card"]')].map(card => ({ id: card.dataset.cardId, disabled: card.disabled })),
  }));
  assert.deepEqual(boardAfter, boardBefore, 'Changing artwork preserves card identities, legal moves and the game state');
  assert.ok(await pages[0].locator('.game-page .card-face-image').evaluateAll(images => images.every(image => new URL(image.src).pathname.startsWith('/cards/smrekar/'))));
  const backs = pages[0].locator('.game-page .card-back-image');
  assert.ok(await backs.count() > 0, 'The table displays hidden cards');
  assert.ok(await backs.evaluateAll((images, url) => images.every(image => new URL(image.src).pathname === url), cardBackImage('smrekar').split('?')[0]), 'The matching Smrekar back is displayed');
  assert.ok(await pages[1].locator('.game-page .card-face-image').evaluateAll(images => images.every(image => new URL(image.src).pathname.startsWith('/cards/deck/'))), 'The opponent keeps their own deck');
  assert.ok(await pages[1].locator('.game-page .card-back-image').evaluateAll((images, url) => images.every(image => new URL(image.src).pathname === url), cardBackImage(DEFAULT_DECK).split('?')[0]), 'The opponent keeps their own back');
  const allUrls = [...new Set(CARD_DECKS.flatMap(deck => cardImageUrls(deck.id)))];
  await expect.poll(() => pages[0].evaluate(async () => (await (await caches.open('tarok-card-art-v1')).keys()).length), { timeout: 30000 }).toBe(allUrls.length);
  // Close the page to discard all in-memory preloads. A fresh tab must still
  // retrieve every card with the network unavailable, via the persistent cache.
  await pages[0].close();
  const fresh = await contexts[0].newPage();
  await fresh.goto(`${origin}/?room=${room}`);
  await expect(fresh.locator('.game-page')).toBeVisible();
  assert.ok(await fresh.locator('.game-page .card-face-image').evaluateAll(images => images.every(image => new URL(image.src).pathname.startsWith('/cards/smrekar/'))), 'The saved choice survives page closure');
  assert.ok(await fresh.locator('.game-page .card-back-image').evaluateAll((images, url) => images.every(image => new URL(image.src).pathname === url), cardBackImage('smrekar').split('?')[0]), 'The matching back also survives page closure');
  await contexts[0].setOffline(true);
  const cached = await fresh.evaluate(async urls => {
    const results = [];
    for (const url of urls) {
      const response = await fetch(url).catch(error => { throw new Error(`${url}: ${error.message}`); });
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        results.push(response.ok && response.headers.get('content-type')?.startsWith('image/') && image.naturalWidth > 0);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
    return results;
  }, allUrls);
  assert.ok(cached.every(Boolean), 'Every face and back in all three decks, including SVG pip cards, decodes after page closure with the network unavailable');
  assert.equal(await fresh.evaluate(() => fetch('/health').then(() => true, () => false)), false, 'Private/app endpoints must not be cached by the artwork worker');
  await contexts[0].setOffline(false);
  const cacheKeys = await fresh.evaluate(async () => (await (await caches.open('tarok-card-art-v1')).keys()).map(request => new URL(request.url).pathname));
  assert.equal(cacheKeys.length, allUrls.length);
  assert.ok(cacheKeys.every(url => url.startsWith('/cards/')));
  for (const deck of ['slovenian', 'smrekar']) {
    const response = await fetch(`${origin}${cardImageUrls(deck).find(url => url.includes('.svg'))}`);
    assert.match(response.headers.get('cache-control'), /max-age=31536000/);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: immediate game entry with delayed artwork, visible-card priority, independent faces and backs, unchanged gameplay, saved Smrekar preference, ${allUrls.length} images from all three decks decoded offline in a fresh tab, and no caching of game endpoints.`);
} finally {
  release();
  await browser.close();
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
}
