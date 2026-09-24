// Real-UI responsive smoke test. BASELINE=1 records layout violations without
// failing on them; functional errors always fail. No game API or seed endpoint.
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const baseline = process.env.BASELINE === '1';
const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/responsive');
const viewports = [
  [320, 568], [375, 667], [390, 844], [568, 320], [667, 375], [844, 390],
  [768, 1024], [820, 1180], [1024, 768], [1180, 820],
].map(([width, height]) => ({ width, height }));
const report = {
  baseURL, baseline, startedAt: new Date().toISOString(), viewports,
  measurements: [], violations: [], screenshots: [], browserErrors: [],
  rooms: [], actions: [], lifecycle: [], navigationChecks: [], guidanceChecks: [], playContexts: [],
};
const gameSelector = '.game-page';
const cardSelector = '[data-testid="play-card"]';
let browser;
let pages = [];
let intentionalClose = false;
const log = message => process.stdout.write(`${message}\n`);

async function state(page) {
  return page.evaluate(() => {
    const game = document.querySelector('.game-page');
    const stackState = root => [...document.querySelectorAll(`${root} .stack`)].map(stack => ({
      index: Number(stack.dataset.stackIndex), count: Number(stack.dataset.stackCount),
      top: stack.dataset.topCardId || null,
    }));
    return {
      phase: game?.dataset.phase || null, round: Number(game?.dataset.round || 0),
      preparationTurn: game?.dataset.preparationTurn === "" ? null : Number(game?.dataset.preparationTurn),
      you: Number(game?.dataset.you), turn: game?.dataset.turn === '' ? null : Number(game?.dataset.turn),
      trick: Number(game?.dataset.trickNumber || 0), trickCards: game?.dataset.trickCardIds || '',
      pickups: Number(game?.dataset.pickupCount || 0), ready: game?.dataset.announcementReady || '',
      hand: [...document.querySelectorAll('.hand-panel [data-testid="play-card"]')].map(card => card.dataset.cardId).sort(),
      ownStacks: stackState('.my-stacks'), otherStacks: stackState('.opponent-stacks'),
      pickupOptions: [...document.querySelectorAll('[data-testid="pickup-card"]')].map(button => ({
        id: button.dataset.cardId, stackIndex: Number(button.dataset.stackIndex), enabled: !button.disabled,
      })),
      enabledCards: [...document.querySelectorAll('[data-testid="play-card"]:not(:disabled)')]
        .map(card => card.dataset.cardId),
    };
  });
}

function persistentState(snapshot) {
  // Button enabled state can legitimately change during socket/animation work.
  const { enabledCards, pickupOptions, ...game } = snapshot;
  return game;
}

async function synchronizedPages() {
  const publicState = snapshot => ({
    phase: snapshot.phase, round: snapshot.round, turn: snapshot.turn, trick: snapshot.trick,
    trickCards: snapshot.trickCards, pickups: snapshot.pickups, ready: snapshot.ready,
    stacks: snapshot.you === 0 ? [snapshot.ownStacks, snapshot.otherStacks] : [snapshot.otherStacks, snapshot.ownStacks],
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(state));
    if (JSON.stringify(publicState(states[0])) === JSON.stringify(publicState(states[1]))) return states;
    await pages[0].waitForTimeout(25);
  }
  throw new Error('The two browser seats did not synchronize their public state.');
}

async function waitPhase(phase) {
  await Promise.all(pages.map(page => page.waitForFunction(expected =>
    document.querySelector('.game-page')?.dataset.phase === expected, phase, { timeout: 20_000 })));
}

async function stableAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  await page.waitForTimeout(80);
}

async function measure(page, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await stableAssets(page);
  const data = await page.evaluate(() => {
    const rectangle = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const rendered = element => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const name = element => element.dataset.testid || element.getAttribute('aria-label')
      || element.dataset.cardId || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 65);
    const px = value => Number.parseFloat(value) || 0;
    const dialog = document.querySelector('[role="dialog"]');
    const scope = dialog || document;
    const cards = [...scope.querySelectorAll('.playing-card, .stack')].filter(rendered).map(element => {
      const css = getComputedStyle(element);
      const borderX = px(css.borderLeftWidth) + px(css.borderRightWidth);
      const borderY = px(css.borderTopWidth) + px(css.borderBottomWidth);
      const width = px(css.width) + (css.boxSizing === 'border-box' ? 0 : borderX + px(css.paddingLeft) + px(css.paddingRight));
      const height = px(css.height) + (css.boxSizing === 'border-box' ? 0 : borderY + px(css.paddingTop) + px(css.paddingBottom));
      const stack = element.matches('.stack');
      const image = stack ? null : element.querySelector('img');
      return { name: name(element), kind: stack ? 'stack' : 'card', width, height,
        widthError: Math.abs(width - height * 63 / 113),
        loaded: !image || (image.complete && image.naturalWidth > 0),
        imagePresent: stack || Boolean(image), objectFit: image ? getComputedStyle(image).objectFit : null,
        opacity: css.opacity,
        hitRectangle: rectangle(element),
      };
    });
    const controlSelector = dialog ? 'button' : '.header-right button, .game-page button:not(.playing-card)';
    const controls = [...scope.querySelectorAll(controlSelector)].filter(rendered).map(element => ({
      name: name(element), disabled: element.disabled, rectangle: rectangle(element),
      // Supplemental pickup/history details may legitimately require vertical scrolling.
      supplemental: Boolean(element.closest('.pickup-options, .pickup-note, .hand-hint, .public-announcements')),
    }));
    const centerElements = [...document.querySelectorAll('.center-play button, .center-play .playing-card')].filter(rendered);
    const tableCards = [...document.querySelectorAll('.my-stacks .playing-card, .opponent-stacks .playing-card')].filter(rendered);
    const overlaps = [];
    if (!dialog) for (const center of centerElements) for (const card of tableCards) {
      const a = rectangle(center), b = rectangle(card);
      const width = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (width > 1 && height > 1) overlaps.push({ center: name(center), card: name(card), width, height });
    }
    const hand = document.querySelector('.hand-scroll');
    return {
      phase: document.querySelector('.game-page')?.dataset.phase,
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
      scrollY, hand: hand ? { ...rectangle(hand), scrollWidth: hand.scrollWidth, clientWidth: hand.clientWidth } : null,
      dialog: dialog ? { name: dialog.getAttribute('aria-label'), ...rectangle(dialog),
        clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight } : null,
      table: rectangle(document.querySelector('.game-table')),
      centerElements: !dialog ? centerElements.map(element => ({ name: name(element), ...rectangle(element) })) : [],
      cards, controls, overlaps,
    };
  });
  const violations = [];
  const issue = (kind, detail) => violations.push({ label, kind, detail });
  if (data.viewport.width !== page.viewportSize().width) issue('viewport-width', data.viewport);
  if (data.documentWidth > data.viewport.width + 1) issue('horizontal-overflow', `${data.documentWidth} > ${data.viewport.width}`);
  if (!data.dialog && data.table && data.hand && data.hand.y < data.table.bottom - 1) {
    issue('hand-not-below-table', { hand: data.hand, table: data.table });
  }
  for (const card of data.cards) {
    if (card.widthError > 0.025) issue('card-ratio', card);
    if (!card.loaded || !card.imagePresent || (card.kind === 'card' && card.objectFit !== 'cover')) issue('card-image', card);
    if (card.kind === 'card' && card.opacity !== '1') issue('translucent-card', card);
  }
  for (const control of data.controls) {
    const r = control.rectangle;
    if (r.width < 43.9 || r.height < 43.9) issue('touch-target', control);
    if (!control.supplemental && (r.y < -1 || r.bottom > data.documentHeight + 1 || r.x < -1 || r.right > data.viewport.width + 1)) {
      issue('primary-control-outside-viewport', control);
    }
  }
  for (const overlap of data.overlaps) issue('table-control-overlap', overlap);
  if (data.table) for (const element of data.centerElements) {
    if (element.x < data.table.x - 1 || element.right > data.table.right + 1
      || element.y < data.table.y - 1 || element.bottom > data.table.bottom + 1) {
      issue('phase-control-outside-table', { element, table: data.table });
    }
  }
  if (data.dialog && (data.dialog.y < -1 || data.dialog.bottom > data.viewport.height + 1
    || data.dialog.x < -1 || data.dialog.right > data.viewport.width + 1)) issue('dialog-outside-viewport', data.dialog);
  report.violations.push(...violations);
  report.measurements.push({ label, ...data, violations: violations.length });
  const file = `${label}.png`;
  await page.screenshot({ path: path.join(artifacts, file), fullPage: false, animations: 'disabled' });
  report.screenshots.push(file);
  if (data.documentHeight > data.viewport.height + 1 && !data.dialog) {
    const fullFile = `${label}-full.png`;
    await page.screenshot({ path: path.join(artifacts, fullFile), fullPage: true, animations: 'disabled' });
    report.screenshots.push(fullFile);
  }
  return data;
}

async function matrix(phaseLabel) {
  const original = pages[0].viewportSize();
  const before = persistentState((await synchronizedPages())[0]);
  for (const viewport of viewports) {
    await pages[0].setViewportSize(viewport);
    const label = `${phaseLabel}-${viewport.width}x${viewport.height}`;
    await measure(pages[0], label);
    if (phaseLabel === 'playing') await verifySuitNavigation(pages[0], label);
    assert.deepEqual(persistentState(await state(pages[0])), before, 'Resizing must preserve the same game and cards.');
  }
  await pages[0].setViewportSize(original);
  await measure(pages[1], `${phaseLabel}-second-context-1024x768`);
  log(`${phaseLabel}: captured all ${viewports.length} viewports and the isolated second seat.`);
}

async function verifySuitNavigation(page, label) {
  const buttons = page.getByTestId('hand-suit');
  const groups = await page.locator('.hand-scroll .suit-group').evaluateAll(elements =>
    elements.map(element => element.dataset.suit));
  const choices = await buttons.evaluateAll(elements => elements.map(element => element.dataset.suit));
  if (!choices.length || JSON.stringify([...choices].sort()) !== JSON.stringify([...groups].sort())) {
    report.violations.push({ label, kind: 'suit-navigation-missing', detail: { groups, choices } });
    return;
  }
  const before = persistentState(await state(page));
  for (const suit of choices) {
    const button = page.locator(`[data-testid="hand-suit"][data-suit="${suit}"]`);
    // First reach the hand normally; then the suit action must only scroll the hand.
    await button.click({ trial: true });
    const initialWindowY = await page.evaluate(() => scrollY);
    const initialScrollLeft = await page.locator('.hand-scroll').evaluate(hand => hand.scrollLeft);
    await button.click();
    let revealed = true;
    try {
      await page.waitForFunction(suit => {
        const hand = document.querySelector('.hand-scroll');
        const target = hand?.querySelector(`.suit-group[data-suit="${suit}"] .playing-card`);
        if (!hand || !target) return false;
        const outer = hand.getBoundingClientRect(), card = target.getBoundingClientRect();
        return card.left >= outer.left - 1 && card.right <= outer.right + 1;
      }, suit, { timeout: 2_000 });
    } catch {
      revealed = false;
      report.violations.push({ label, kind: 'suit-jump-does-not-reveal-card', detail: suit });
    }
    const scroll = await page.evaluate(() => ({ windowY: scrollY, handX: document.querySelector('.hand-scroll')?.scrollLeft }));
    if (Math.abs(scroll.windowY - initialWindowY) > 1) report.violations.push({ label, kind: 'suit-jump-scrolls-window', detail: { suit, ...scroll } });
    assert.deepEqual(persistentState(await state(page)), before, 'Suit navigation must not change game state or play a card.');
    report.navigationChecks.push({ label, suit, revealed, initialScrollLeft, ...scroll });
  }
  await page.locator('.hand-scroll').evaluate(hand => hand.scrollTo({ left: 0, behavior: 'instant' }));
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function createRoom() {
  if (await pages[0].getByTestId('player-name').count()) await pages[0].getByTestId('player-name').fill('Ana');
  await pages[0].getByTestId('create-room').click();
  await pages[0].getByTestId('room-code').waitFor();
  const code = (await pages[0].getByTestId('room-code').textContent()).trim();
  await pages[1].goto(await pages[0].getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue(), { waitUntil: 'networkidle' });
  await pages[1].setViewportSize({ width: 320, height: 568 });
  assert.equal(await pages[1].getByTestId('join-code').count(), 0);
  assert.equal(await pages[1].getByTestId('join-room').isDisabled(), true);
  if (await pages[1].getByTestId('player-name').count()) await pages[1].getByTestId('player-name').fill('Luka');
  const compactJoin = await pages[1].getByTestId('join-room').boundingBox();
  assert.ok(compactJoin.y + compactJoin.height <= 568, 'Join fits a small phone.');
  const invitation = { privateLink: true };
  await pages[1].screenshot({ path: path.join(artifacts, 'invitation-join-320.png'), animations: 'disabled' });
  await pages[1].getByTestId('join-room').click();
  await waitPhase('bidding');
  await pages[1].setViewportSize({ width: 1024, height: 768 });
  report.guidanceChecks.push({ kind: 'invitation-first-join', passed: true, ...invitation });
  report.rooms.push({ code });
  report.roomCode = code;
  return code;
}

async function leaveRoom() {
  for (const page of pages) {
    await page.getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zapusti mizo', exact: true }).click();
    await page.getByTestId('create-room').waitFor();
  }
}

async function ensureAnaBids() {
  const initial = (await synchronizedPages())[0];
  if (initial.turn !== initial.you) {
    // One opening pass leaves bidding open and puts its live controls on the
    // first context, so all phone/tablet sizes exercise the actual buttons.
    await pages[1].getByTestId('bid-pass').click();
    await Promise.all(pages.map(page => page.waitForFunction(you => {
      const game = document.querySelector('.game-page');
      return game?.dataset.phase === 'bidding' && Number(game.dataset.turn) === you;
    }, initial.you)));
    report.rooms.at(-1).openingPass = 'Luka';
  }
  await pages[0].getByTestId('bid-play').waitFor();
  assert.equal(await pages[0].getByTestId('bid-play').isEnabled(), true,
    'Ana must have live bid controls before the viewport matrix.');
}

async function bid() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const button = page.getByTestId('bid-play');
      if (await button.count() && await button.isEnabled()) {
        await button.click();
        await waitPhase('playing');
        return;
      }
    }
    await pages[0].waitForTimeout(50);
  }
  throw new Error('Neither seat could bid.');
}

async function pickup() {
  const before = await state(pages[0]);
  const statusBefore = await pages[0].getByTestId('game-status').textContent();
  const choice = before.pickupOptions[0];
  assert.ok(choice, 'The selected room must expose an optional honor for the first context.');
  await pages[0].locator(`[data-testid="pickup-card"][data-card-id="${choice.id}"]`).click();
  await Promise.all(pages.map(page => page.waitForFunction(expected =>
    Number(document.querySelector('.game-page')?.dataset.pickupCount) === expected, before.pickups + 1)));
  const after = await state(pages[0]);
  assert.deepEqual(after.hand, [...before.hand, choice.id].sort(), 'An explicit pickup adds exactly one named card to the hand.');
  assert.equal(after.ownStacks[choice.stackIndex].count, before.ownStacks[choice.stackIndex].count - 1);
  assert.equal(after.turn, before.turn, 'A pickup must not consume the turn.');
  assert.equal(after.trickCards, before.trickCards, 'A pickup must not play the card.');
  assert.equal(await pages[0].getByTestId('game-status').textContent(), statusBefore, 'An optional pickup must not repeat or change the live turn announcement.');
  report.pickup = { cardId: choice.id, before, after, passed: true };
}

async function preparationGuidance() {
  for (const page of pages) {
    assert.equal(await page.getByTestId('announcement-panel').count(), 0);
    assert.equal(await page.getByTestId('confirm-announcements').count(), 0);
  }
  report.guidanceChecks.push({ kind: 'immediate-play-without-preparation', passed: true });
}

async function confirm() {
  await waitPhase('playing');
  report.immediatePlay = true;
}

async function playCard() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(state));
    for (const [index, snapshot] of states.entries()) {
      const id = snapshot.enabledCards[0];
      if (!id) continue;
      // Keep identity stable while the completed-trick animation may disable it.
      await pages[index].locator(`${cardSelector}[data-card-id="${id}"]`).click();
      await pages[index].waitForFunction(cardId =>
        ![...document.querySelectorAll('[data-testid="play-card"]')].some(card => card.dataset.cardId === cardId), id);
      report.actions.push({ player: index === 0 ? 'Ana' : 'Luka', cardId: id });
      return;
    }
    await pages[0].waitForTimeout(75);
  }
  throw new Error('No actual card play became available.');
}

async function modalMatrix(kind) {
  const open = page => kind === 'rules' ? page.locator('.header-rules').click() : page.locator('.last-trick button').click();
  await Promise.all(pages.map(open));
  await Promise.all(pages.map(page => page.getByRole('dialog').waitFor()));
  if (kind === 'last-trick') assert.equal(await pages[0].getByRole('dialog').locator('.card-face-image').count(), 2,
    'Last-trick history must display both played card scans.');
  await matrix(kind);
  for (const page of pages) {
    await page.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0, 'A dialog must close through its visible close control.');
  }
}

await mkdir(artifacts, { recursive: true });
try {
  let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) {
    try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch { /* Use Playwright's installed browser. */ }
  }
  browser = await chromium.launch({ headless: process.env.HEADLESS !== '0', ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  browser.on('disconnected', () => report.lifecycle.push({ event: 'browser-disconnected', intentional: intentionalClose, at: new Date().toISOString() }));
  const contexts = await Promise.all([{ width: 390, height: 844 }, { width: 1024, height: 768 }].map(viewport =>
    browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true })));
  pages = await Promise.all(contexts.map(context => context.newPage()));
  pages.forEach((page, index) => {
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.browserErrors.push({ player: index, message: error.message }));
    page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string' || !/^42\d*\[/.test(payload)) return;
      const [event, action] = JSON.parse(payload.slice(payload.indexOf('[')));
      if (event === 'game:action' && action?.type === 'play') report.playContexts.push({ player: index, expectedPlay: action.expectedPlay });
    }));
  });
  await Promise.all(pages.map(page => page.goto(baseURL, { waitUntil: 'networkidle' })));
  for (let attempt = 0; attempt < 3; attempt++) {
    await createRoom();
    await ensureAnaBids();
    await matrix('bidding');
    await bid();
    if ((await state(pages[0])).pickupOptions.length) break;
    report.rooms.at(-1).rejected = 'Ana has no exposed optional honor in this shuffled deal.';
    if (attempt === 2) throw new Error('Three shuffled deals provided no optional pickup for Ana; rerun to exercise that control.');
    await leaveRoom();
  }
  const prep = await Promise.all(pages.map(state));
  assert.ok(prep.every(snapshot => snapshot.hand.length === 15 && snapshot.pickups === 0 && snapshot.enabledCards.length === 0),
    'Preparation must preserve the original hands, leave honors untouched, and disable play.');
  await matrix('preparation');
  await preparationGuidance();
  await pickup();
  await matrix('optional-pickup');
  await confirm();
  await playCard();
  await matrix('playing');
  for (let index = 0; index < 3; index++) await playCard();
  assert.equal(report.actions.length, 4, 'The smoke test must exercise four actual UI plays, separate from pickup.');
  assert.equal(new Set(report.actions.map(action => action.cardId)).size, 4);
  assert.equal(report.playContexts.length, 4, 'Every UI play must send exactly one contextualized request.');
  for (const { expectedPlay: context } of report.playContexts) assert.ok(context && Number.isInteger(context.round)
    && Number.isInteger(context.trickNumber) && [0, 1].includes(context.trickSize), 'UI play requests must carry their displayed table position.');
  await pages[0].waitForTimeout(900);
  await modalMatrix('last-trick');
  await modalMatrix('rules');
  report.finalStates = await Promise.all(pages.map(state));
  assert.ok(report.finalStates.every(snapshot => snapshot.phase === 'playing' && snapshot.trick === 3),
    'The same room must remain playable after two tricks and all viewport/dialog changes.');
  assert.equal(report.browserErrors.length, 0, 'The responsive workflow must not produce JavaScript errors.');
  report.layoutPassed = report.violations.length === 0;
  report.passed = baseline || report.layoutPassed;
  if (!report.passed) process.exitCode = 1;
  log(`${baseline ? 'BASELINE' : report.passed ? 'PASS' : 'FAIL'}: ${report.measurements.length} responsive checkpoints, ${report.violations.length} layout violations, four UI plays, room ${report.roomCode}.`);
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  report.failureStates = await Promise.all(pages.map(page => state(page).catch(() => null)));
  await Promise.all(pages.map((page, index) => page.screenshot({ path: path.join(artifacts, `failure-${index + 1}.png`) }).catch(() => {})));
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  intentionalClose = true;
  if (browser) await browser.close().catch(() => {});
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
