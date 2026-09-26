import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { detectLanguage, LANGUAGE_STORAGE_KEY, translatorFor } from '../../src/i18n.mjs';
import { CARD_DECKS, cardBackImage, cardImage, cardImageUrls, DECK_STORAGE_KEY } from '../../src/decks.mjs';
import { DECK_STORIES } from '../../src/deck-stories.mjs';
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

async function verifyMobileHeader(page) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const box = element => {
      const { left, right, width, height } = element.getBoundingClientRect();
      return { left, right, width, height };
    };
    const logo = document.querySelector('.header-brand .logo');
    const status = document.querySelector('.header-brand .connection-status');
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      wordmark: logo.textContent, logo: box(logo), status: box(status),
      controls: [...document.querySelectorAll('.header-right button')].map(box),
      statusAmongActions: !!document.querySelector('.header-right .connection-status'),
    };
  });
  assert.equal(layout.width, 320);
  assert.ok(layout.documentWidth <= layout.width + 1, 'The mobile home screen must not overflow horizontally');
  assert.match(layout.wordmark, /tarokza2/);
  assert.ok(layout.status.left >= layout.logo.right && layout.status.left - layout.logo.right <= 10,
    'The connection indicator must sit beside the wordmark');
  assert.equal(layout.statusAmongActions, false);
  assert.equal(layout.controls.length, 3, 'Guests have Cards, Help and Settings header controls');
  for (const [index, control] of layout.controls.entries()) {
    assert.ok(control.width >= 43.5 && control.height >= 43.5, 'Header controls retain 44px touch targets');
    assert.ok(control.left >= 0 && control.right <= layout.width, 'Header controls fit the mobile viewport');
    assert.ok(control.left >= (index ? layout.controls[index - 1].right : layout.status.right),
      'The wordmark, status and header controls do not overlap');
  }
  await expect(page.locator('.site-header [data-testid="language-select"]')).toHaveCount(0);
}

async function verifySettings(page) {
  const settings = page.locator('.game-settings-modal');
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId('language-select')).toBeVisible();
  await expect(settings.locator('[data-testid="settings-deck-select"], [data-testid="deck-select"], [data-testid="settings-deck-story"], [data-testid="deck-story"]')).toHaveCount(0);
  await expect(settings.getByTestId('settings-player-name')).toHaveCount(0);
  await expect(settings.getByTestId('settings-devices')).toHaveCount(0);
  assert.equal(await page.evaluate(() => localStorage.getItem('tarokza2.device')), null,
    'Public checks must remain an anonymous guest');
}

async function verifyDeckStory(page, deck) {
  const locale = await page.locator('html').getAttribute('lang');
  const translate = translatorFor(locale);
  const expected = DECK_STORIES[deck];
  const story = page.getByRole('dialog').getByTestId('deck-story');
  await expect(story).toHaveCount(1);
  await expect(story).toHaveAttribute('data-deck', deck);
  await expect(story.locator('h3')).toHaveText(translate(CARD_DECKS.find(item => item.id === deck).name));
  await expect(story.locator(':scope > p')).toHaveText([
    translate(expected.description), `${translate('Zgodovina')} ${translate(expected.history)}`,
  ]);
  const sources = story.locator('.deck-story-sources a');
  await expect(sources).toHaveText(expected.sources.map(source => translate(source.label)));
  assert.deepEqual(await sources.evaluateAll(links => links.map(link => link.getAttribute('href'))),
    expected.sources.map(source => source.url), `${deck}: source links match the release provenance`);
  for (const link of await sources.evaluateAll(links => links.map(link => ({ href: link.href, target: link.target, rel: link.rel })))) {
    assert.equal(new URL(link.href).protocol, 'https:');
    assert.equal(link.target, '_blank');
    assert.ok(link.rel.split(/\s+/).includes('noopener') && link.rel.split(/\s+/).includes('noreferrer'));
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${deck}: the gallery and its story fit the mobile viewport`);
}

async function verifyDeckGallery(page, deck) {
  await verifyDeckStory(page, deck);
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
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
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
    await verifyMobileHeader(page);
    await page.getByTestId('game-settings').click();
    await verifySettings(page);
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
    await page.keyboard.press('Escape');
    await page.getByTestId('deck-gallery').click();
    const deckSelector = page.getByTestId('deck-select');
    await expect(deckSelector).toHaveValue('modiano');
    await expect(deckSelector.locator('option[value="modiano"]')).toHaveText('Modiano');
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
    await verifyMobileHeader(page);
    await page.getByTestId('game-settings').click();
    await verifySettings(page);
    await expect(selector).toHaveValue(explicitLanguage);
    await expect(page.locator('html')).toHaveAttribute('lang', explicitLanguage);
    await expect(page).toHaveTitle(translatorFor(explicitLanguage)('TarokZa2 · Dobra družba. Dobre karte.'));
    await page.keyboard.press('Escape');
    await page.getByTestId('deck-gallery').click();
    await expect(deckSelector).toHaveValue('smrekar');
    await expect(deckSelector.locator('option[value="modiano"]')).toHaveText('Modiano');
    await verifyDeckGallery(page, 'smrekar');
    assert.deepEqual(await page.evaluate(() => window.securityViolations), []);
    assert.deepEqual(errors, []);
    const headers = response.headers();
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['strict-transport-security'], 'max-age=31536000');
    assert.equal(await page.evaluate(() => localStorage.getItem('tarokza2.device')), null);
    console.log(`${host}: 320px guest header/status/touch targets, Cards-only selection, Modiano label, all three translated descriptions/histories and HTTPS sources, 12 languages, IP/browser default (${defaultLanguage}), ${Object.keys(expectedHashes).length} face/back hashes and image types (16 Slovenian + 13 Smrekar SVG), saved language/Smrekar choices, CSP and secure WebSocket checked`);
    await context.close();
  }
} finally {
  await browser.close();
}
