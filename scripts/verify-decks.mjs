// Real table and mobile gallery checks; all games use disposable local data.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';
import { CARD_DECKS, cardBackImage, cardImageUrls } from '../src/decks.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/decks');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-decks-'));
const server = await createTarokServer({ dataDir });
const address = await server.listen(0, '127.0.0.1');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const report = { passed: false, checks: [], screenshots: [], browserErrors: [], layouts: [] };
const nginxConfig = await readFile(new URL('../nginx.it13.conf', import.meta.url), 'utf8');
const contentSecurityPolicy = nginxConfig.match(/add_header Content-Security-Policy "([^"]+)"/)[1];
await mkdir(artifacts, { recursive: true });

async function snapshot(page) {
  return page.locator('.game-page').evaluate(game => ({
    state: { ...game.dataset },
    cards: [...game.querySelectorAll('[data-testid="play-card"]')].map(card => ({
      id: card.dataset.cardId, disabled: card.disabled, label: card.getAttribute('aria-label'),
    })),
    stacks: [...game.querySelectorAll('.stack')].map(stack => ({ ...stack.dataset })),
    score: document.querySelector('.score-button')?.textContent,
  }));
}

async function layout(page, label) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('.card-face-image, .card-back-image')].map(image => image.decode()));
  });
  const measure = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const picker = document.querySelector('[data-testid="deck-select"]');
    const box = element => element && ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right });
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      dialog: dialog && { ...box(dialog), clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth },
      picker: box(picker),
      unloaded: [...document.querySelectorAll('.card-face-image, .card-back-image')].filter(image => !image.complete || !image.naturalWidth).length,
    };
  });
  report.layouts.push({ label, ...measure });
  assert.ok(measure.documentWidth <= measure.width + 1, `${label}: document fits viewport`);
  assert.equal(measure.unloaded, 0, `${label}: all visible faces decode`);
  if (measure.dialog) {
    assert.ok(measure.dialog.scrollWidth <= measure.dialog.clientWidth + 1, `${label}: gallery has no horizontal overflow`);
    assert.ok(measure.dialog.left >= 0 && measure.dialog.right <= measure.width + 1);
  }
  if (measure.picker) assert.ok(measure.picker.left >= 0 && measure.picker.right <= measure.width + 1, `${label}: selector fits`);
}

async function screenshot(page, filename) {
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true });
  report.screenshots.push(filename);
}

async function selectDeck(page, value) {
  await page.getByTestId('deck-gallery').click();
  await page.getByTestId('deck-select').selectOption(value);
  await page.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
}

async function verifyGallery(page, deck) {
  const faces = page.getByRole('dialog').locator('.card-face-image');
  await expect(faces).toHaveCount(54);
  await expect.poll(() => faces.evaluateAll(images => images.map(image => new URL(image.src).pathname).sort()))
    .toEqual(cardImageUrls(deck).slice(1).map(url => url.split('?')[0]).sort());
}

async function verifyTableArtwork(page, deck) {
  const prefix = deck === 'modiano' ? '/cards/deck/' : `/cards/${deck}/`;
  const faces = page.locator('.game-page .card-face-image');
  const backs = page.locator('.game-page .card-back-image');
  assert.ok(await faces.count() > 0, `${deck}: exposed cards are present`);
  assert.ok(await backs.count() > 0, `${deck}: hidden cards are present`);
  assert.ok(await faces.evaluateAll((images, prefix) => images.every(image => new URL(image.src).pathname.startsWith(prefix)), prefix), `${deck}: visible faces follow selection`);
  assert.ok(await backs.evaluateAll((images, url) => images.every(image => new URL(image.src).pathname === url), cardBackImage(deck).split('?')[0]), `${deck}: hidden cards follow selection`);
}

try {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ locale: 'sl-SI', viewport: { width: 320, height: 844 } })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [a, b] = pages;
  for (const page of pages) {
    // Local Express is normally behind Nginx. Apply its actual production policy
    // to this disposable browser session, including self-contained SVG images.
    await page.route(`${origin}/**`, async route => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': contentSecurityPolicy } });
    });
    page.on('pageerror', error => report.browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /content security policy|violates.*directive|refused to/i.test(message.text())) {
        report.browserErrors.push(message.text());
      }
    });
  }
  const response = await a.goto(origin);
  assert.match(response.headers()['content-security-policy'], /img-src 'self' data:/);
  await a.getByTestId('deck-gallery').click();
  await expect(a.getByTestId('deck-select')).toHaveValue('modiano');
  await expect(a.getByTestId('deck-select')).toHaveAccessibleName('Komplet kart');
  assert.deepEqual(await a.getByTestId('deck-select').locator('option').evaluateAll(options => options.map(option => option.value)), CARD_DECKS.map(deck => deck.id));
  for (const { id: deck } of CARD_DECKS) {
    await a.getByTestId('deck-select').selectOption(deck);
    await verifyGallery(a, deck);
    await layout(a, `${deck} gallery at 320px`);
    await screenshot(a, `gallery-${deck}-320.png`);
    // The heart section shows pip and court faces together.
    const hearts = a.locator('.deck-section').filter({ has: a.locator('[data-card-id="hearts-4"]') });
    await hearts.scrollIntoViewIfNeeded();
    await screenshot(a, `gallery-${deck}-pips-320.png`);
  }
  await a.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
  await a.getByTestId('player-name').fill('Ana');
  await a.getByTestId('create-room').click();
  await expect(a.getByTestId('room-code')).toBeVisible();
  const room = (await a.getByTestId('room-code').textContent()).trim();
  const savePath = path.join(dataDir, `${room}.json`);
  await b.goto(await a.locator('.invite-url').inputValue());
  await b.getByTestId('player-name').fill('Luka');
  await b.getByTestId('join-room').click();
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', 'bidding')));
  for (let count = 0; count < 2; count++) {
    const states = await Promise.all(pages.map(snapshot));
    const actor = states.findIndex(state => state.state.turn === state.state.you);
    await pages[actor].getByTestId('bid-pass').click();
    if (count === 0) await expect(pages[1 - actor].getByTestId('bid-pass')).toBeVisible();
  }
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', 'playing')));
  // Complete one trick and lead another, exercising spent cards, collected points
  // and a face already on the table when the artwork preference changes.
  for (let count = 0; count < 3; count++) {
    const states = await Promise.all(pages.map(snapshot));
    const actor = states.findIndex(state => state.state.turn === state.state.you);
    await pages[actor].locator('[data-testid="play-card"]:enabled').first().click();
    await expect.poll(async () => (await snapshot(pages[actor])).state.trickCardIds).not.toBe(states[actor].state.trickCardIds);
  }
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-trick-number', '2')));
  await expect(a.getByTestId('trick-collection')).toHaveCount(0, { timeout: 10000 });
  const before = await Promise.all(pages.map(snapshot));
  const savedBefore = await readFile(savePath, 'utf8');
  assert.ok(before[0].state.trickCardIds, 'The table contains a played card');
  for (const deck of ['modiano', 'slovenian', 'smrekar', 'modiano', 'smrekar']) {
    await selectDeck(a, deck);
    assert.deepEqual(await Promise.all(pages.map(snapshot)), before, `${deck}: table, identities, legal cards and scores stay unchanged`);
    await verifyTableArtwork(a, deck);
    await verifyTableArtwork(b, 'modiano');
    await layout(a, `${deck} live table at 320px`);
    await screenshot(a, `table-${deck}-320.png`);
  }
  assert.equal(await readFile(savePath, 'utf8'), savedBefore, 'Changing artwork does not write game saves');
  await a.reload();
  await expect(a.locator('.game-page')).toHaveAttribute('data-trick-number', '2');
  await expect.poll(async () => snapshot(a)).toEqual(before[0]);
  await verifyTableArtwork(a, 'smrekar');
  await a.getByTestId('deck-gallery').click();
  await expect(a.getByTestId('deck-select')).toHaveValue('smrekar');
  await a.setViewportSize({ width: 1024, height: 900 });
  for (const deck of ['slovenian', 'smrekar']) {
    await a.getByTestId('deck-select').selectOption(deck);
    await verifyGallery(a, deck);
    await layout(a, `${deck} gallery at 1024px`);
    await screenshot(a, `gallery-${deck}-1024.png`);
    await a.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
    await layout(a, `${deck} live table at 1024px`);
    await screenshot(a, `table-${deck}-1024.png`);
    if (deck === 'slovenian') await a.getByTestId('deck-gallery').click();
  }
  assert.equal(await readFile(savePath, 'utf8'), savedBefore, 'Reload retains the identical game save');
  report.checks.push('Modiano default, accessible three-deck selector, all 54 Slovenian and 54 Smrekar faces, production CSP, no horizontal overflow at 320px and 1024px.');
  report.checks.push('Switching all three decks during the second trick updates faces and backs, retains played cards, legal moves, hand IDs, points, score display and the exact saved game; opponent faces and backs are independent and reload preserves Smrekar.');
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
  console.log('PASS: mobile and desktop Slovenian/Smrekar galleries and tables, loaded pip cards under CSP, mid-round changes across all three decks and matching backs, independent artwork, unchanged saves and scores, Smrekar reload persistence.');
} finally {
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
}
