import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { detectLanguage, LANGUAGE_STORAGE_KEY, translatorFor } from '../../src/i18n.mjs';
import { CARD_DECKS, cardBackImage, cardImage, cardImageUrls, DECK_STORAGE_KEY } from '../../src/decks.mjs';
import { createDeck } from '../../shared/cards.mjs';

// Read-only public browser checks. No identities, tables or games are created.
// Language and deck changes only update storage in this disposable browser context.
const languageCodes = ['sl', 'en', 'es', 'de', 'fr', 'it', 'cs', 'sk', 'hu', 'da', 'ro', 'pl'];
const expectedHashes = Object.fromEntries(await Promise.all(
  [...new Set(CARD_DECKS.flatMap(deck => cardImageUrls(deck.id)))].map(async url => {
    const bytes = await readFile(new URL(`../../public${url.split('?')[0]}`, import.meta.url));
    return [url, createHash('sha256').update(bytes).digest('hex')];
  }),
));

async function verifyDeckGallery(page, deck) {
  const faces = page.getByRole('dialog').locator('.card-face-image');
  await expect(faces).toHaveCount(54);
  await expect.poll(() => faces.evaluateAll(images => images.map(image => new URL(image.src).pathname).sort()))
    .toEqual(createDeck().map(card => cardImage(card, deck).split('?')[0]).sort());
  const decoded = await faces.evaluateAll(async images => {
    let timer;
    try {
      await Promise.race([
        Promise.all(images.map(image => image.decode())),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Card image decoding timed out')), 30000); }),
      ]);
      return images.map(image => ({ path: new URL(image.currentSrc || image.src).pathname, loaded: image.complete && image.naturalWidth > 0 }));
    } finally {
      clearTimeout(timer);
    }
  });
  assert.ok(decoded.every(image => image.loaded), `${deck}: every face must decode`);
  assert.equal(decoded.filter(image => image.path.endsWith('.svg')).length,
    { modiano: 0, slovenian: 16, smrekar: 13 }[deck], `${deck}: expected reconstructed pip faces must decode`);
  for (const rank of [1, 21, 22]) {
    assert.ok(decoded.some(image => image.path === cardImage(`tarok-${rank}`, deck).split('?')[0]), 'The gallery trula must use the selected artwork');
  }
  const assets = await page.evaluate(async ({ urls, back }) => {
    const image = new Image();
    image.src = back;
    await image.decode();
    return Promise.all(urls.map(async url => {
      // Reuse the image response; avoid another uncached gallery-sized burst.
      const response = await fetch(url, { cache: 'force-cache' });
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      return { url, status: response.status, type: response.headers.get('content-type'), hash };
    }));
  }, { urls: cardImageUrls(deck), back: cardBackImage(deck) });
  for (const asset of assets) {
    assert.equal(asset.status, 200, asset.url);
    const extension = asset.url.split('?')[0].split('.').at(-1);
    assert.equal(asset.type.split(';')[0], { jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml' }[extension], `${asset.url}: image content type`);
    assert.equal(asset.hash, expectedHashes[asset.url], `${asset.url}: deployed bytes match release artwork`);
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
});
try {
  for (const [index, host] of ['tarok.moonlitgarden.cc', 'tarok.moonlitgarden.xyz'].entries()) {
    // Both hosts share a 20 requests/second, burst-100 limit for this runner's IP.
    // Let its allowance recover between independent, uncached deck galleries.
    if (index > 0) await delay(6000);
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(() => {
      window.securityViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.securityViolations.push({ directive: event.violatedDirective, uri: event.blockedURI });
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const websocket = page.waitForEvent('websocket', { timeout: 15000 });
    const localeResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/locale');
    const response = await page.goto(`https://${host}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    const socket = await websocket;
    assert.match(socket.url(), /^wss:/);
    const detectedResponse = await localeResponse;
    assert.equal(detectedResponse.status(), 200);
    const detected = await detectedResponse.json();
    assert.deepEqual(Object.keys(detected), ['country']);
    assert.ok(detected.country === null || /^[A-Z]{2}$/.test(detected.country));
    const cacheControl = detectedResponse.headers()['cache-control'].split(',').map(value => value.trim().toLowerCase());
    assert.ok(cacheControl.includes('private') && cacheControl.includes('no-store'));
    const preferred = await page.evaluate(() => navigator.languages);
    const defaultLanguage = detectLanguage(null, preferred, detected.country);
    const selector = page.getByTestId('language-select');
    await expect(selector).toBeVisible();
    assert.deepEqual(await selector.locator('option').evaluateAll(options => options.map(option => option.value)), languageCodes);
    await expect(selector).toHaveValue(defaultLanguage);
    await expect(page.locator('html')).toHaveAttribute('lang', defaultLanguage);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY), null);
    for (const code of languageCodes) {
      await selector.selectOption(code);
      await expect(selector).toHaveValue(code);
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page).toHaveTitle(translatorFor(code)('TarokZa2 · Dobra družba. Dobre karte.'));
    }
    const explicitLanguage = defaultLanguage === 'es' ? 'en' : 'es';
    await selector.selectOption(explicitLanguage);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY), explicitLanguage);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DECK_STORAGE_KEY), null);
    await page.getByTestId('deck-gallery').click();
    const deckSelector = page.getByTestId('deck-select');
    await expect(deckSelector).toHaveValue('modiano');
    assert.deepEqual(await deckSelector.locator('option').evaluateAll(options => options.map(option => option.value)), CARD_DECKS.map(deck => deck.id));
    for (const [deckIndex, { id }] of CARD_DECKS.entries()) {
      if (deckIndex > 0) await delay(6000);
      await deckSelector.selectOption(id);
      await expect(deckSelector).toHaveValue(id);
      await verifyDeckGallery(page, id);
    }
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DECK_STORAGE_KEY), 'smrekar');
    assert.deepEqual(await page.evaluate(() => window.securityViolations), []);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(selector).toHaveValue(explicitLanguage);
    await expect(page.locator('html')).toHaveAttribute('lang', explicitLanguage);
    await expect(page).toHaveTitle(translatorFor(explicitLanguage)('TarokZa2 · Dobra družba. Dobre karte.'));
    await page.getByTestId('deck-gallery').click();
    await expect(deckSelector).toHaveValue('smrekar');
    await verifyDeckGallery(page, 'smrekar');
    assert.deepEqual(await page.evaluate(() => window.securityViolations), []);
    assert.deepEqual(errors, []);
    const headers = response.headers();
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['strict-transport-security'], 'max-age=31536000');
    console.log(`${host}: 12 languages, IP/browser default (${defaultLanguage}), Modiano default, all three galleries, ${Object.keys(expectedHashes).length} face/back hashes and image types (16 Slovenian + 13 Smrekar SVG), saved language/Smrekar choices, CSP and secure WebSocket checked`);
    await context.close();
  }
} finally {
  await browser.close();
}
