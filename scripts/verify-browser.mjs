import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createDeck } from '../shared/cards.mjs';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts');
const headless = process.env.HEADLESS !== '0';
const keepBrowserOpen = process.env.KEEP_BROWSER_OPEN === '1';
const cardSelector = '[data-testid="play-card"]';
const gameSelector = '.game-page';
const canonicalCards = createDeck();
const cardsById = new Map(canonicalCards.map(card => [card.id, card]));
const verifiedGameCardIds = new Set();
const report = {
  baseURL,
  headless,
  startedAt: new Date().toISOString(),
  players: [
    { name: 'Ana', viewport: { width: 390, height: 844 } },
    { name: 'Luka', viewport: { width: 1024, height: 768 } },
  ],
  screenshots: [],
  rounds: [],
  browserErrors: [],
  cardImageChecks: [],
  cardGeometryChecks: [],
  optionalPickups: [],
  fixturePickups: [],
  preparations: [],
  directHonorPlays: [],
};

await mkdir(artifacts, { recursive: true });
let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
if (!executablePath) {
  try {
    await access('/usr/bin/chromium');
    executablePath = '/usr/bin/chromium';
  } catch {
    // Playwright uses its installed browser if Chromium is not provided by the OS.
  }
}
const browser = await chromium.launch({
  headless,
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const contexts = await Promise.all(report.players.map(({ viewport }) =>
  browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true }),
));
const pages = await Promise.all(contexts.map(context => context.newPage()));
pages.forEach((page, playerIndex) => {
  page.setDefaultTimeout(10_000);
  page.on('console', message => {
    if (message.type() === 'error' && /content security policy|violates.*directive|refused to/i.test(message.text())) {
      report.browserErrors.push({ player: report.players[playerIndex].name, message: message.text() });
    }
  });
  page.on('pageerror', error => report.browserErrors.push({
    player: report.players[playerIndex].name,
    message: error.message,
  }));
});

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function snapshot(page) {
  return page.evaluate((selector) => {
    const game = document.querySelector('.game-page');
    const cards = [...document.querySelectorAll(selector)];
    const hand = document.querySelector('.hand-scroll');
    const stackState = root => [...document.querySelectorAll(`${root} .stack`)].map(stack => ({
      index: Number(stack.dataset.stackIndex),
      count: Number(stack.dataset.stackCount),
      topId: stack.dataset.topCardId || null,
    }));
    const pickupOptions = [...document.querySelectorAll('[data-testid="pickup-card"]')].map(button => ({
      id: button.dataset.cardId,
      stackIndex: Number(button.dataset.stackIndex),
      enabled: !button.disabled,
    }));
    return {
      phase: game?.dataset.phase || null,
      preparationTurn: game?.dataset.preparationTurn === "" ? null : Number(game?.dataset.preparationTurn),
      round: Number(game?.dataset.round || 0),
      you: game?.dataset.you === undefined ? null : Number(game.dataset.you),
      turn: !game || game.dataset.turn === '' || game.dataset.turn === undefined ? null : Number(game.dataset.turn),
      trickNumber: Number(game?.dataset.trickNumber || 0),
      trickCardIds: game?.dataset.trickCardIds?.split(',').filter(Boolean) || [],
      pickupCount: Number(game?.dataset.pickupCount || 0),
      announcements: JSON.parse(game?.dataset.announcements || '[]'),
      announcementReady: game?.dataset.announcementReady?.split(',').map(value => value === 'true') || [],
      handIds: [...document.querySelectorAll(`.hand-panel ${selector}`)].map(card => card.dataset.cardId).sort(),
      ownStacks: stackState('.my-stacks'),
      opponentStacks: stackState('.opponent-stacks'),
      pickupOptions,
      eligiblePickupIds: pickupOptions.map(option => option.id).sort(),
      cards: cards.length,
      cardIds: cards.map(card => card.dataset.cardId).sort(),
      enabled: cards.filter(card => !card.disabled).map(card => ({
        id: card.dataset.cardId,
        label: card.getAttribute('aria-label') || card.textContent.trim(),
      })),
      scoreboardRows: document.querySelectorAll('[data-testid="scoreboard-row"]').length,
      ready: document.querySelector('[data-testid="ready-count"]')?.textContent.trim() || null,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      handBottom: hand ? Math.ceil(hand.getBoundingClientRect().bottom + window.scrollY) : null,
    };
  }, cardSelector);
}

function publicBoard(state) {
  return {
    phase: state.phase, round: state.round, turn: state.turn,
    trickNumber: state.trickNumber, trickCardIds: state.trickCardIds, pickupCount: state.pickupCount,
    announcements: state.announcements, announcementReady: state.announcementReady,
    stacks: state.you === 0 ? [state.ownStacks, state.opponentStacks] : [state.opponentStacks, state.ownStacks],
  };
}

async function synchronizedBoards() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(snapshot));
    if (JSON.stringify(publicBoard(states[0])) === JSON.stringify(publicBoard(states[1]))) return states;
    await pages[0].waitForTimeout(25);
  }
  throw new Error('Both browsers did not synchronize the public table state.');
}

function isHonor(cardId) {
  const card = cardsById.get(cardId);
  return card?.suit === 'tarok' || card?.rank === 8;
}

function hasDelayedPickup() {
  const playingPickups = report.optionalPickups.filter(pickup => pickup.phase === 'playing');
  return playingPickups.some((pickup, index) => index > 0 && pickup.playsLeftExposed >= 2);
}

async function takeOptionalPickup(playerIndex, option, round, plays, firstSeen, { fixture = false } = {}) {
  const before = await synchronizedBoards();
  const actorBefore = before[playerIndex];
  const otherIndex = 1 - playerIndex;
  const stackBefore = actorBefore.ownStacks.find(stack => stack.index === option.stackIndex);
  assert.equal(stackBefore?.topId, option.id, 'Only the exposed top card can be taken into the hand.');
  assert.ok(isHonor(option.id), 'Only a tarok or king may be taken into the hand.');
  assert.ok(actorBefore.eligiblePickupIds.includes(option.id), 'The offered pickup must still be eligible.');
  // A pickup moves this ID from a stack into the hand, so unlike an actual play,
  // the ID must remain among play-card buttons after the action.
  await pages[playerIndex].locator(`[data-testid="pickup-card"][data-card-id="${option.id}"]`).click();
  await Promise.all(pages.map(page => page.waitForFunction(expectedCount =>
    Number(document.querySelector('.game-page')?.dataset.pickupCount) === expectedCount,
  actorBefore.pickupCount + 1, { timeout: 10_000 })));
  const after = await synchronizedBoards();
  const actorAfter = after[playerIndex];
  const stackAfter = actorAfter.ownStacks.find(stack => stack.index === option.stackIndex);
  assert.deepEqual(actorAfter.handIds, [...actorBefore.handIds, option.id].sort(),
    'A pickup must add exactly the chosen card to the hand.');
  assert.deepEqual(after[otherIndex].handIds, before[otherIndex].handIds,
    'Taking a card must not change the other player\'s hand.');
  assert.equal(stackAfter?.count, stackBefore.count - 1, 'A pickup must remove exactly one card from its stack.');
  assert.notEqual(stackAfter.topId, option.id, 'The taken card must no longer remain on its stack.');
  assert.equal(Boolean(stackAfter.topId), stackAfter.count > 0, 'The next top card must become public if the stack is not empty.');
  assert.equal(after[otherIndex].opponentStacks.find(stack => stack.index === option.stackIndex)?.topId, stackAfter.topId,
    'Both players must see the same newly exposed top card.');
  assert.deepEqual(actorAfter.ownStacks.filter(stack => stack.index !== option.stackIndex),
    actorBefore.ownStacks.filter(stack => stack.index !== option.stackIndex), 'The other stacks must remain unchanged.');
  assert.deepEqual(actorAfter.opponentStacks, actorBefore.opponentStacks, 'The opponent\'s stacks must remain unchanged.');
  for (const [index, state] of after.entries()) {
    assert.equal(state.turn, before[index].turn, 'Taking a card must not consume or change the turn.');
    assert.equal(state.trickNumber, before[index].trickNumber, 'Taking a card must not advance the trick.');
    assert.deepEqual(state.trickCardIds, before[index].trickCardIds, 'Taking a card must not play it into the current trick.');
    assert.equal(state.pickupCount, before[index].pickupCount + 1, 'Exactly one pickup must be added to public history.');
  }
  if (stackAfter.topId && isHonor(stackAfter.topId)) {
    assert.ok(actorAfter.eligiblePickupIds.includes(stackAfter.topId), 'The next exposed honor must remain an optional separate pickup.');
    assert.ok(!actorAfter.handIds.includes(stackAfter.topId), 'A pickup must not automatically take the next exposed honor.');
  }
  const result = {
    round, phase: actorBefore.phase, player: report.players[playerIndex].name, cardId: option.id, stackIndex: option.stackIndex,
    afterCardsPlayed: plays, firstOfferedAfterCardsPlayed: firstSeen,
    playsLeftExposed: plays - firstSeen, offTurn: actorBefore.phase === 'playing' && actorBefore.turn !== actorBefore.you,
    handBefore: actorBefore.handIds.length, handAfter: actorAfter.handIds.length,
    stackBefore: stackBefore.count, stackAfter: stackAfter.count, nextPublicCard: stackAfter.topId,
    remainingOptionalCards: actorAfter.eligiblePickupIds, turnPreserved: true, trickPreserved: true,
  };
  const records = fixture ? report.fixturePickups : report.optionalPickups;
  records.push(result);
  await Promise.all(pages.map((page, index) => inspectCardImages(page.locator(gameSelector),
    `${fixture ? 'Fixture' : 'Optional'} pickup ${records.length}, ${report.players[index].name}`)));
  log(`${result.player} took ${cardsById.get(option.id).name} into the hand ${result.phase === 'announcements' ? 'during preparation' : result.offTurn ? 'off-turn' : 'on-turn'} after ${plays} actual card plays; the turn and trick stayed unchanged.`);
  return result;
}

async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifacts, name), fullPage: true, animations: 'disabled' });
  report.screenshots.push(name);
}

async function assertNoOverflow(page, label) {
  const state = await snapshot(page);
  assert.equal(state.viewportWidth, page.viewportSize().width,
    `${label} expanded the layout viewport beyond the emulated screen width.`);
  assert.ok(state.documentWidth <= state.viewportWidth + 1,
    `${label} overflows horizontally: ${state.documentWidth}px > ${state.viewportWidth}px`);

}

async function inspectCardGeometry(container, label) {
  const layouts = await container.locator('.playing-card, .stack').evaluateAll(elements => elements.filter(element => element.getClientRects().length > 0).map(element => {
    const style = getComputedStyle(element);
    const px = value => Number.parseFloat(value) || 0;
    const borderX = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const borderY = px(style.borderTopWidth) + px(style.borderBottomWidth);
    const paddingX = px(style.paddingLeft) + px(style.paddingRight);
    const paddingY = px(style.paddingTop) + px(style.paddingBottom);
    // Computed styles describe layout before the card's rotation/hover transform.
    const width = px(style.width) + (style.boxSizing === 'border-box' ? 0 : borderX + paddingX);
    const height = px(style.height) + (style.boxSizing === 'border-box' ? 0 : borderY + paddingY);
    const stack = element.matches('.stack');
    const image = stack ? null : element.querySelector('img');
    let imageLayout = null;
    if (image) {
      const imageStyle = getComputedStyle(image);
      const imageWidth = px(imageStyle.width);
      const imageHeight = px(imageStyle.height);
      const scale = Math.max(imageWidth / image.naturalWidth, imageHeight / image.naturalHeight);
      const renderedWidth = image.naturalWidth * scale;
      const renderedHeight = image.naturalHeight * scale;
      imageLayout = {
        objectFit: imageStyle.objectFit,
        objectPosition: imageStyle.objectPosition,
        loaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        horizontalInset: Math.max(0, (width - borderX - renderedWidth) / 2),
        verticalInset: Math.max(0, (height - borderY - renderedHeight) / 2),
        cropPerSide: Math.max((renderedWidth - imageWidth) / renderedWidth, (renderedHeight - imageHeight) / renderedHeight) / 2,
      };
    }
    return {
      id: element.dataset.cardId || element.getAttribute('aria-label') || 'stack slot',
      kind: stack ? 'stack' : element.matches('.card-back') ? 'back' : 'face',
      width, height, opacity: style.opacity, image: imageLayout,
    };
  }));
  for (const layout of layouts) {
    assert.ok(layout.width > 0 && layout.height > 0, `${label}: ${layout.id} must have a measurable card box.`);
    const widthError = Math.abs(layout.width - layout.height * 63 / 113);
    assert.ok(widthError <= 0.025,
      `${label}: ${layout.kind} ${layout.id} must use the 63:113 outer-box ratio; got ${layout.width}×${layout.height}px (width error ${widthError.toFixed(4)}px).`);
    if (layout.kind !== 'stack') {
      assert.ok(layout.image?.loaded, `${label}: ${layout.id} must contain a loaded card image.`);
      assert.equal(layout.opacity, '1', `${label}: ${layout.id} must stay opaque so overlapping cards cannot show through.`);
      assert.equal(layout.image.objectFit, 'cover', `${label}: ${layout.id} must fill its frame without letterboxing.`);
      assert.equal(layout.image.objectPosition, '50% 50%', `${label}: ${layout.id} must have symmetric framing.`);
      assert.ok(layout.image.cropPerSide <= 0.05, `${label}: ${layout.id} may trim only the outer paper margin (at most 5% per side): ${JSON.stringify(layout)}.`);
      assert.ok(layout.image.verticalInset <= 0.025, `${label}: ${layout.id} must not leave bands above or below the scan.`);
      assert.ok(layout.image.horizontalInset <= 1,
        `${label}: ${layout.id} has ${layout.image.horizontalInset.toFixed(2)}px unused horizontal space per side inside its border.`);
    }
  }
  report.cardGeometryChecks.push({
    label,
    expectedRatio: '63:113',
    faceCards: layouts.filter(layout => layout.kind === 'face').length,
    cardBacks: layouts.filter(layout => layout.kind === 'back').length,
    stackSlots: layouts.filter(layout => layout.kind === 'stack').length,
    maxWidthErrorPx: Math.max(0, ...layouts.map(layout => Math.abs(layout.width - layout.height * 63 / 113))),
    maxHorizontalInsetPx: Math.max(0, ...layouts.map(layout => layout.image?.horizontalInset || 0)),
    passed: true,
  });
}

async function inspectCardImages(container, label) {
  const faces = container.locator('.playing-card:not(.card-back)');
  const images = faces.locator('.card-face-image');
  const faceCount = await faces.count();
  assert.equal(await images.count(), faceCount, `${label}: every face-up card must use a real deck image.`);
  assert.equal(await container.locator('.playing-card .card-corner, .playing-card .court-art, .playing-card .card-pip, .playing-card .card-art').count(), 0,
    `${label}: old letter/pip/SVG placeholder cards must not remain.`);
  await Promise.all((await images.all()).map(image => image.evaluate(element => element.decode())));
  const rendered = await faces.evaluateAll(cards => cards.map(card => {
    const image = card.querySelector('.card-face-image');
    return {
      id: card.dataset.cardId,
      label: card.getAttribute('aria-label'),
      alt: image?.alt,
      source: image ? new URL(image.currentSrc || image.src).pathname : null,
      loaded: image?.complete && image.naturalWidth > 0,
      naturalWidth: image?.naturalWidth,
      naturalHeight: image?.naturalHeight,
    };
  }));
  for (const card of rendered) {
    const expected = cardsById.get(card.id);
    assert.ok(expected, `${label}: unknown image card id ${card.id}.`);
    assert.equal(card.source?.split('/').at(-1), `${card.id}.jpg`,
      `${label}: ${card.id} must display its own scanned face.`);
    assert.ok(card.loaded, `${label}: ${card.id} image failed to load.`);
    assert.equal(card.label?.replace(/^Igraj /u, ''), expected.name,
      `${label}: accessible label must identify ${card.id} correctly.`);
    assert.ok(!card.alt || card.alt === expected.name,
      `${label}: image alternative text must identify ${card.id} correctly.`);
  }
  const backs = container.locator('.playing-card.card-back');
  assert.equal(await backs.locator('img').count(), await backs.count(),
    `${label}: every hidden card must use the real deck back.`);
  const backSources = await Promise.all((await backs.locator('img').all()).map(image => image.evaluate(async element => {
    await element.decode();
    if (!element.complete || !element.naturalWidth) throw new Error('Card-back image failed to load.');
    return new URL(element.currentSrc || element.src).pathname;
  })));
  for (const source of backSources) assert.equal(source, '/cards/back-ornament.png', `${label}: hidden cards must display the supplied ornamental back.`);
  await inspectCardGeometry(container, label);
  report.cardImageChecks.push({ label, faceImages: rendered.length, backImages: await backs.count(), passed: true });
  return rendered;
}

async function verifyDeckGallery(page) {
  assert.equal(canonicalCards.length, 54, 'The canonical Tarok deck must contain 54 cards.');
  assert.equal(cardsById.size, 54, 'The canonical Tarok deck must contain 54 unique card identities.');
  await page.getByTestId('deck-gallery').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const images = dialog.locator('.playing-card:not(.card-back) .card-face-image');
  assert.equal(await images.count(), 54, 'The deck gallery must show all 54 card faces.');
  // Scrolling every gallery face also exercises normal loading if images are lazy.
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(element => element.decode());
  }
  const rendered = await inspectCardImages(dialog, 'Complete real-deck gallery');
  assert.equal(new Set(rendered.map(card => card.id)).size, 54, 'Every gallery card identity must be unique.');
  assert.equal(new Set(rendered.map(card => card.source)).size, 54, 'Every gallery card must use a distinct face scan.');
  assert.deepEqual(rendered.map(card => card.id).sort(), [...cardsById.keys()].sort(),
    'The gallery must include every canonical card exactly once.');
  await screenshot(page, 'real-deck-gallery-suits.png');
  await dialog.getByRole('heading').first().scrollIntoViewIfNeeded();
  await screenshot(page, 'real-deck-gallery-tablet.png');
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: originalViewport.width, height: 4000 });
  await dialog.getByRole('heading').first().scrollIntoViewIfNeeded();
  await inspectCardGeometry(dialog, 'Full-height deck gallery export');
  await dialog.screenshot({ path: path.join(artifacts, 'real-deck-gallery.png'), animations: 'disabled' });
  report.screenshots.push('real-deck-gallery.png');
  await page.setViewportSize(originalViewport);
  report.realDeckGallery = { cards: rendered, uniqueFaces: rendered.length, passed: true };
  await dialog.getByRole('button', { name: 'Zapri', exact: true }).click();
  log('Real-deck gallery verified: 54 distinct, loaded scans with matching card identities and Slovenian labels.');
}

async function checkNarrowPhone(page, screenshotName) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 740 });
  await assertNoOverflow(page, screenshotName);
  await inspectCardGeometry(page.locator('body'), `${screenshotName}, 320px layout`);
  await screenshot(page, screenshotName);
  await page.setViewportSize(original);
}

async function waitForBothPhase(phase, round) {
  await Promise.all(pages.map(page => page.waitForFunction(
    ({ phase: expectedPhase, round: expectedRound }) => {
      const game = document.querySelector('.game-page');
      return game?.dataset.phase === expectedPhase
        && (!expectedRound || Number(game.dataset.round) === expectedRound);
    },
    { phase, round },
    { timeout: 20_000 },
  )));
}

async function finishBidding(round, announce) {
  const actions = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(snapshot));
    if (states.every(state => state.phase === 'announcements')) return actions;
    assert.ok(states.every(state => ['bidding', 'announcements'].includes(state.phase)),
      `Unexpected bidding state for round ${round}: ${JSON.stringify(states)}`);
    let acted = false;
    for (const [index, page] of pages.entries()) {
      if (states[index].phase !== 'bidding') continue;
      const testId = announce ? 'bid-play' : 'bid-pass';
      const candidate = page.getByTestId(testId);
      if (await candidate.count() && await candidate.isEnabled() && await candidate.isVisible()) {
        await candidate.click();
        actions.push({ player: report.players[index].name, action: testId });
        acted = true;
        // An announcement can end bidding immediately. Allow both sockets to render it.
        await page.waitForTimeout(150);
        break;
      }
    }
    if (!acted) await pages[0].waitForTimeout(100);
  }
  throw new Error(`Bidding stalled in round ${round}: ${JSON.stringify(await Promise.all(pages.map(snapshot)))}`);
}

async function verifyUntouchedPreparation(round) {
  await waitForBothPhase('announcements', round);
  const initialStates = await synchronizedBoards();
  for (const state of initialStates) {
    assert.equal(state.handIds.length, 15, 'Bidding must end with the original 15-card hand; exposed honors stay on their stacks.');
    assert.equal(state.ownStacks.length, 3, 'Each player must begin with three stacks.');
    assert.ok(state.ownStacks.every(stack => stack.count === 4 && stack.topId),
      'Every stack must begin with four cards and exactly one publicly exposed top.');
    assert.equal(state.pickupCount, 0, 'No honor may be taken automatically after bidding.');
    assert.deepEqual(state.announcementReady, [false, false], 'Both players must initially remain unconfirmed.');
    assert.equal(state.enabled.length, 0, 'No card can be played during preparation.');
    assert.deepEqual(state.eligiblePickupIds, state.ownStacks.filter(stack => isHonor(stack.topId)).map(stack => stack.topId).sort(),
      'Every exposed own tarok or king must be offered as an optional pickup.');
  }
  await pages[0].waitForTimeout(120);
  const untouchedStates = await synchronizedBoards();
  for (const [index, state] of untouchedStates.entries()) {
    assert.deepEqual(state.handIds, initialStates[index].handIds, 'Leaving pickup choices untouched must preserve the hand.');
    assert.deepEqual(state.ownStacks, initialStates[index].ownStacks, 'Leaving pickup choices untouched must preserve every exposed honor.');
  }
  return initialStates;
}

async function confirmPreparation(round, { fixture = false } = {}) {
  const before = await synchronizedBoards();
  assert.ok(before.every(state => state.phase === 'announcements' && state.enabled.length === 0),
    'Neither player can play before both confirm preparation.');
  const first = before.findIndex(state => state.you === state.preparationTurn);
  const second = 1 - first;
  assert.equal(await pages[second].getByTestId('confirm-announcements').isEnabled(), false, 'The starter must confirm first.');
  await pages[first].getByTestId('confirm-announcements').click();
  await pages[first].waitForFunction(you => {
    const ready = document.querySelector('.game-page')?.dataset.announcementReady?.split(',');
    return ready?.[you] === 'true';
  }, before[first].you);
  const firstReady = await synchronizedBoards();
  assert.ok(firstReady.every(state => state.phase === 'announcements' && state.enabled.length === 0),
    'One confirmation must not enable play or end preparation.');
  assert.equal(firstReady[0].announcementReady[before[first].you], true);
  assert.equal(firstReady[0].announcementReady[before[second].you], false);
  assert.equal(await pages[first].getByTestId('confirm-announcements').isEnabled(), false,
    'An individual confirmation must be irrevocable.');
  assert.ok(firstReady[first].pickupOptions.every(option => !option.enabled),
    'Confirming must lock the player\'s own pickup choices.');
  for (const bonus of ['kings', 'trula', 'valat']) {
    assert.equal(await pages[first].getByTestId(`announce-${bonus}`).isEnabled(), false,
      'Confirming must lock the player\'s own announcements.');
  }
  await pages[second].getByTestId('confirm-announcements').click();
  await waitForBothPhase('playing', round);
  const final = await synchronizedBoards();
  assert.deepEqual(final[0].announcements, before[0].announcements, 'All public bonus calls must survive the start of play.');
  log(`${fixture ? 'Fixture' : `Round ${round}`}: both confirmations required; first confirmation locked only that player\'s choices.`);
  return { firstReady, bothReady: final, passed: true };
}

async function prepareAnnouncements(round) {
  const initialStates = await verifyUntouchedPreparation(round);
  await Promise.all(pages.map((page, index) => inspectCardImages(page.locator(gameSelector),
    `Round ${round} preparation, ${report.players[index].name}`)));
  if (round === 1) {
    await screenshot(pages[0], 'announcement-mobile.png');
    await screenshot(pages[1], 'announcement-tablet.png');
  }
  const playerIndex = initialStates.findIndex(state => state.pickupOptions.length > 0);
  const pickup = playerIndex < 0 ? null : await takeOptionalPickup(playerIndex,
    initialStates[playerIndex].pickupOptions[0], round, 0, 0);
  const confirmation = await confirmPreparation(round);
  const result = { round, initialStates, pickup, confirmation };
  report.preparations.push(result);
  return result;
}

async function verifyAnnouncementFixtures(fixtureURL) {
  assert.notEqual(new URL(fixtureURL).origin, new URL(baseURL).origin,
    'Deterministic fixture checks must use a separate server origin.');
  await Promise.all(pages.map(page => page.goto(fixtureURL, { waitUntil: 'networkidle' })));
  await pages[0].getByTestId('player-name').fill('Ana');
  await pages[0].getByTestId('create-room').click();
  await pages[0].getByTestId('room-code').waitFor();
  const roomCode = (await pages[0].getByTestId('room-code').textContent()).trim();
  await pages[1].getByTestId('join-name').fill('Luka');
  await pages[1].getByTestId('join-code').fill(roomCode);
  await pages[1].getByTestId('join-room').click();
  await waitForBothPhase('bidding', 1);
  await finishBidding(1, true);
  const initial = await verifyUntouchedPreparation(1);
  const actor = pages[0];
  assert.ok(['clubs-8', 'spades-8', 'hearts-8', 'diamonds-8', 'tarok-1', 'tarok-21', 'tarok-22']
    .every(id => initial[0].handIds.includes(id)), 'The isolated fixture must give Ana complete kings and trula in hand.');
  for (const bonus of ['kings', 'trula']) {
    assert.equal(await actor.getByTestId(`announce-${bonus}`).isEnabled(), true,
      `The complete ${bonus} set in hand must enable its announcement.`);
    assert.equal(await pages[1].getByTestId(`announce-${bonus}`).isEnabled(), false,
      `An incomplete ${bonus} set must not be announceable.`);
  }
  assert.equal(await actor.getByTestId('announce-valat').isEnabled(), false,
    'Valat must remain unavailable while hidden cards remain in the player\'s stacks.');

  async function announce(bonus) {
    await actor.getByTestId(`announce-${bonus}`).click();
    await Promise.all(pages.map(page => page.waitForFunction(({ player, bonus }) =>
      JSON.parse(document.querySelector('.game-page')?.dataset.announcements || '[]')
        .some(call => call.player === player && call.bonus === bonus),
    { player: initial[0].you, bonus })));
    assert.equal(await actor.getByTestId(`announce-${bonus}`).getAttribute('aria-pressed'), 'true',
      'A completed announcement must remain visibly selected.');
    assert.equal(await actor.getByTestId(`announce-${bonus}`).isEnabled(), false,
      'A completed announcement must not be retractable or repeatable.');
    for (const page of pages) {
      assert.equal(await page.locator(`[data-testid="public-announcement"][data-player="${initial[0].you}"][data-bonus="${bonus}"]`).count(), 1,
        'Both players must see each public announcement exactly once.');
    }
  }
  await announce('kings');
  await announce('trula');
  for (let index = 0; index < 9; index++) {
    const states = await synchronizedBoards();
    const option = states[0].pickupOptions.find(candidate =>
      states[0].ownStacks.find(stack => stack.index === candidate.stackIndex)?.count > 1);
    assert.ok(option, 'The fixture must expose one of its nine separately pickable taroks.');
    await takeOptionalPickup(0, option, 1, 0, 0, { fixture: true });
    if (index < 8) assert.equal(await actor.getByTestId('announce-valat').isEnabled(), false,
      'Valat must stay unavailable until the final hidden stack card is exposed.');
  }
  const uncovered = await synchronizedBoards();
  assert.ok(uncovered[0].ownStacks.every(stack => stack.count === 1 && stack.topId),
    'Exactly one public card per stack must remain after nine fixture pickups.');
  assert.equal(uncovered[0].handIds.length, 24, 'The last three public stack cards need not be picked up for valat.');
  assert.equal(await actor.getByTestId('announce-valat').isEnabled(), true,
    'Seeing the complete hand and the last three public stack cards must enable valat.');
  await announce('valat');
  await screenshot(pages[0], 'announcement-bonuses-mobile.png');
  await screenshot(pages[1], 'announcement-bonuses-tablet.png');
  const confirmation = await confirmPreparation(1, { fixture: true });
  const result = await playAnnouncementFixtureResult();
  report.announcementFixtures = {
    baseURL: fixtureURL, roomCode, initialHands: initial.map(state => state.handIds),
    announced: ['kings', 'trula', 'valat'], explicitPickups: 9,
    lastThreeCardsStayedPublic: true, confirmation, result, passed: true,
  };
  log('Isolated browser fixture passed: eligible public calls, nine explicit pickups, both confirmations, and failed valat correctly shown as −500 despite winning most card points.');
}

async function playAnnouncementFixtureResult() {
  const actions = [];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(snapshot));
    if (states.every(state => state.phase === 'roundEnd')) break;
    assert.ok(states.every(state => ['playing', 'roundEnd'].includes(state.phase)),
      `Unexpected announcement-fixture state: ${JSON.stringify(states)}`);
    let acted = false;
    for (const [index, page] of pages.entries()) {
      if (states[index].phase !== 'playing' || !states[index].enabled.length) continue;
      // Preserve the exact first-enabled UI policy. For this fixed valid deal,
      // Ana wins 24 tricks and 62 card points but does not fulfill her valat.
      const card = states[index].enabled[0];
      const candidate = page.locator(`${cardSelector}[data-card-id="${card.id}"]`);
      const face = candidate.locator('.card-face-image');
      assert.equal(await face.count(), 1, 'Every fixture play must use its matching scanned card face.');
      const faceSource = await face.evaluate(async element => {
        await element.decode();
        if (!element.complete || !element.naturalWidth) throw new Error('Fixture card image failed to load.');
        return new URL(element.currentSrc || element.src).pathname;
      });
      assert.equal(faceSource.split('/').at(-1), `${card.id}.jpg`);
      // The stable ID locator waits through the completed-trick animation;
      // filtering by :not(:disabled) here could race its settling effect.
      await candidate.click();
      await page.waitForFunction(({ cardSelector, cardId }) =>
        ![...document.querySelectorAll(cardSelector)].some(button => button.dataset.cardId === cardId),
      { cardSelector, cardId: card.id }, { timeout: 10_000 });
      actions.push({ player: report.players[index].name, cardId: card.id, label: card.label });
      acted = true;
      if (actions.length % 18 === 0) log(`Announcement fixture: ${actions.length} cards played through the browser.`);
      break;
    }
    if (!acted) await pages[0].waitForTimeout(75);
    assert.ok(actions.length <= 54, 'The announcement fixture must never play a card twice.');
  }
  await waitForBothPhase('roundEnd', 1);
  assert.equal(actions.length, 54, 'The announcement fixture must play all 54 cards through the UI.');
  assert.deepEqual(actions.map(action => action.cardId).sort(), [...cardsById.keys()].sort(),
    'The announcement fixture must play every distinct scanned card exactly once.');
  const finalStates = await synchronizedBoards();
  assert.ok(finalStates.every(state => state.cards === 0 && state.scoreboardRows === 1 && state.trickNumber === 27),
    'Both fixture players must finish all 27 tricks and see the completed scoreboard.');
  const scoreBreakdown = await verifyScoreBreakdowns(1);
  assert.equal(scoreBreakdown.length, 1);
  const row = scoreBreakdown[0];
  assert.deepEqual(row.deltas, [-500, 0], 'Ana must lose 500 for her failed announced valat.');
  assert.ok(row.points[0] > 35 && row.points[0] > row.points[1],
    'This regression fixture must fail valat despite Ana winning the majority of card points.');
  assert.equal(row.contractLabel, 'Napovedan valat', 'The score row must identify the valat override.');
  assert.equal(row.entries.filter(entry => entry.player === 0 && entry.kind === 'valat'
    && entry.points === -500 && entry.label.startsWith('Nap.')).length, 1,
  'The breakdown must explicitly show the failed announced valat once.');
  assert.ok(!row.entries.some(entry => ['game', 'kings', 'trula'].includes(entry.kind)),
    'An announced valat must suppress the base game, kings, and trula scores.');
  const resultViews = await Promise.all(pages.map(async (page, index) => {
    const heading = (await page.getByTestId('round-result-heading').textContent()).trim();
    const description = (await page.getByTestId('round-result-description').textContent()).trim();
    assert.equal(heading, 'Valat ni uspel.', 'The result heading must report the failed valat, not a card-point win.');
    assert.ok(description.includes('Ana') && description.includes('neuspešno napovedan valat')
      && description.replaceAll('−', '-').includes('-500'),
    'The result description must name Ana and explain her failed valat and −500 score.');
    await assertNoOverflow(page, `Failed-valat scoreboard, ${report.players[index].name}`);
    return { player: report.players[index].name, heading, description };
  }));
  await screenshot(pages[0], 'valat-result-mobile.png');
  await screenshot(pages[1], 'valat-result-tablet.png');
  return { cardsPlayed: actions.length, tricksPlayed: actions.length / 2,
    actions, finalStates, scoreBreakdown, resultViews, passed: true };
}

async function verifyScoreBreakdowns(round) {
  const views = await Promise.all(pages.map(page => page.getByTestId('scoreboard-row').evaluateAll(rows => rows.map(row => {
    const cells = [...row.querySelectorAll('td')];
    return {
      round: Number(cells[0].querySelector('strong').textContent),
      contractLabel: cells[0].querySelector('small').textContent.trim(),
      deltas: cells.slice(1).map(cell => Number(cell.querySelector('strong').textContent.replace('−', '-'))),
      points: cells.slice(1).map(cell => Number.parseFloat(cell.querySelector('small').textContent)),
      entries: [...row.querySelectorAll('[data-testid="score-breakdown-entry"]')].map(entry => ({
        player: Number(entry.dataset.player), kind: entry.dataset.kind, points: Number(entry.dataset.points),
        label: entry.textContent.trim(),
      })),
    };
  }))));
  assert.deepEqual(views[0], views[1], 'Both players must see the same complete score breakdown.');
  for (const row of views[0]) {
    assert.ok(row.entries.length > 0, `Round ${row.round} must explain the score with visible breakdown entries.`);
    for (const entry of row.entries) {
      assert.ok([0, 1].includes(entry.player) && Number.isFinite(entry.points), 'Every score component must identify a player and numeric points.');
      assert.ok(['game', 'kings', 'trula', 'valat', 'mondfang'].includes(entry.kind), 'Every score component must have a recognized kind.');
      const announced = entry.label.startsWith('Nap.');
      if (['kings', 'trula'].includes(entry.kind)) {
        assert.ok((announced ? [-20, 20] : [10]).includes(entry.points), 'Sets must display 10 silent or ±20 announced points.');
      } else if (entry.kind === 'valat') {
        assert.ok((announced ? [-500, 500] : [250]).includes(entry.points), 'Valat must display 250 silent or ±500 announced points.');
      } else if (entry.kind === 'mondfang') {
        assert.equal(entry.points, -21, 'A captured mond must display a 21-point penalty.');
      }
    }
    const sums = [0, 1].map(player => row.entries.filter(entry => entry.player === player).reduce((total, entry) => total + entry.points, 0));
    assert.deepEqual(sums, row.deltas, `Round ${row.round}: visible score components must sum to each player's round delta.`);
  }
  if (round === 2) {
    await screenshot(pages[0], 'score-breakdown-mobile.png');
    await screenshot(pages[1], 'score-breakdown-tablet.png');
  }
  return views[0];
}

async function playRound(round, announce) {
  log(`Round ${round}: ${announce ? 'announced game' : 'both players pass'}.`);
  await waitForBothPhase('bidding', round);
  const bids = await finishBidding(round, announce);
  const preparation = await prepareAnnouncements(round);
  await waitForBothPhase('playing', round);
  await Promise.all(pages.map((page, index) => assertNoOverflow(page, `Round ${round}, ${report.players[index].name}`)));
  await Promise.all(pages.map((page, index) => inspectCardImages(page.locator(gameSelector), `Round ${round} initial cards, ${report.players[index].name}`)));

  const initialStates = await synchronizedBoards();
  const actions = [];
  const pickupStart = report.optionalPickups.length;
  const firstOffered = new Map();
  let capturedGameplay = false;
  let verifiedReconnect = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(snapshot));
    if (states.every(state => state.phase === 'roundEnd')) break;
    assert.ok(states.every(state => ['playing', 'roundEnd'].includes(state.phase)),
      `Unexpected game state: ${JSON.stringify(states)}`);

    for (const [index, state] of states.entries()) {
      for (const option of state.pickupOptions) {
        if (!firstOffered.has(option.id)) firstOffered.set(option.id, { playerIndex: index, plays: actions.length });
      }
    }
    const offered = states.flatMap((state, playerIndex) => state.pickupOptions.map(option => ({
      ...option, playerIndex, offTurn: state.turn !== state.you,
      firstSeen: firstOffered.get(option.id).plays,
    })));
    if (offered.length && !report.optionalPickupScreenshots) {
      await screenshot(pages[0], 'optional-pickup-mobile.png');
      await screenshot(pages[1], 'optional-pickup-tablet.png');
      report.optionalPickupScreenshots = { round, afterCardsPlayed: actions.length, offeredCards: offered.map(option => option.id) };
    }
    const needOffTurn = !report.optionalPickups.some(pickup => pickup.offTurn);
    const needsDelayed = !hasDelayedPickup();
    const pickup = needOffTurn
      ? offered.find(option => option.offTurn)
      : needsDelayed && report.optionalPickups.length > 0
        ? offered.find(option => actions.length - option.firstSeen >= 2)
        : null;
    if (pickup) {
      await takeOptionalPickup(pickup.playerIndex, pickup, round, actions.length, pickup.firstSeen);
      continue;
    }

    if (!capturedGameplay && actions.length >= 13) {
      await Promise.all(pages.map((page, index) => inspectCardImages(page.locator(gameSelector), `Round ${round} gameplay, ${report.players[index].name}`)));
      await screenshot(pages[round === 1 ? 0 : 1], `round-${round}-${round === 1 ? 'mobile' : 'tablet'}.png`);
      if (round === 1) await checkNarrowPhone(pages[0], 'round-1-small-mobile.png');
      capturedGameplay = true;
    }

    if (round === 1 && actions.length === 14 && !verifiedReconnect) {
      const before = await snapshot(pages[0]);
      await pages[0].reload({ waitUntil: 'networkidle' });
      await waitForBothPhase('playing', round);
      const after = await snapshot(pages[0]);
      assert.deepEqual(after.cardIds, before.cardIds, 'Reload must restore the same hand and exposed stacks.');
      await inspectCardImages(pages[0].locator(gameSelector), 'Restored cards after refresh');
      report.reconnect = { round, afterCardsPlayed: actions.length, preservedCards: after.cards, passed: true };
      verifiedReconnect = true;
      log('Ana refreshed midway through round 1; her seat and all remaining cards were restored.');
      // State collected before reload may have transiently disabled buttons; recollect it.
      continue;
    }

    let acted = false;
    for (const [index, page] of pages.entries()) {
      const available = states[index].enabled;
      if (!available.length || states[index].phase !== 'playing') continue;
      // Keep optional honors exposed long enough to demonstrate taking one later.
      // If following suit forces that card, play it normally and observe a later offer.
      const preserveOffers = needOffTurn || needsDelayed;
      const card = (preserveOffers && available.find(candidate => !states[index].eligiblePickupIds.includes(candidate.id))) || available[0];
      assert.ok(card.id, 'Every playable card must have a data-card-id for reliable verification.');
      // The completed-trick effect can temporarily disable every button after
      // snapshot(). Keep the chosen card identity stable while click() waits
      // for that animation to finish; a :not(:disabled) lookup would disappear.
      const candidate = page.locator(`${cardSelector}[data-card-id="${card.id}"]`);
      const face = candidate.locator('.card-face-image');
      assert.equal(await face.count(), 1, `${card.id} must be played using its scanned card face.`);
      const faceSource = await face.evaluate(async element => {
        await element.decode();
        if (!element.complete || !element.naturalWidth) throw new Error('Playable card image failed to load.');
        return new URL(element.currentSrc || element.src).pathname;
      });
      assert.equal(faceSource.split('/').at(-1), `${card.id}.jpg`, 'A playable card must display its matching face scan.');
      verifiedGameCardIds.add(card.id);
      // Clicking the actual legal card exercises the same client path as a touch player.
      await candidate.click();
      await page.waitForFunction(({ cardSelector, cardId }) =>
        ![...document.querySelectorAll(cardSelector)].some(button => button.dataset.cardId === cardId),
      { cardSelector, cardId: card.id }, { timeout: 10_000 });
      const source = states[index].ownStacks.some(stack => stack.topId === card.id) ? 'stack' : 'hand';
      actions.push({ player: report.players[index].name, cardId: card.id, label: card.label, source });
      if (source === 'stack' && isHonor(card.id)) {
        report.directHonorPlays.push({ round, player: report.players[index].name, cardId: card.id, afterCardsPlayed: actions.length });
      }
      acted = true;
      if (actions.length % 18 === 0) log(`Round ${round}: ${actions.length} cards played through the browser.`);
      break;
    }
    if (!acted) await pages[0].waitForTimeout(75);
    assert.ok(actions.length <= 54, `Round ${round} played more than the 54 cards in a Tarok deck.`);
  }

  await waitForBothPhase('roundEnd', round);
  assert.equal(actions.length, 54, `Round ${round} must play the complete 54-card deck (27 tricks).`);
  assert.equal(new Set(actions.map(action => action.cardId)).size, 54,
    `Round ${round} must play every distinct scanned card exactly once.`);
  const finalStates = await Promise.all(pages.map(snapshot));
  for (const [index, state] of finalStates.entries()) {
    assert.equal(state.scoreboardRows, round,
      `${report.players[index].name} should see one scoreboard row per completed round.`);
    assert.equal(state.cards, 0, `${report.players[index].name} must have no cards left at the end.`);
  }
  await Promise.all(pages.map((page, index) => assertNoOverflow(page, `Round ${round} scoreboard, ${report.players[index].name}`)));
  await screenshot(pages[round === 1 ? 0 : 1], `round-${round}-scoreboard.png`);
  if (round === 2) await screenshot(pages[0], 'round-2-scoreboard-mobile.png');
  const scoreboardText = await pages[0].getByTestId('scoreboard-row').allTextContents();
  const scoreBreakdown = await verifyScoreBreakdowns(round);
  report.rounds.push({ round, announce, bids, preparation, initialStates, cardsPlayed: actions.length,
    tricksPlayed: actions.length / 2, actions, optionalPickups: report.optionalPickups.slice(pickupStart), finalStates, scoreboardText, scoreBreakdown });
  log(`Round ${round} complete: 27 tricks; scoreboard shows ${round} completed round${round === 1 ? '' : 's'}.`);
}

async function readyForNextRound(round) {
  await pages[0].getByTestId('new-round').click();
  // Prove the first player can ready without starting until the second agrees.
  await pages[0].waitForTimeout(150);
  const firstReady = await snapshot(pages[0]);
  assert.equal(firstReady.phase, 'roundEnd', 'A single ready player must not start a new round.');
  if (round === 3) await screenshot(pages[0], 'round-2-scoreboard-ready.png');
  await pages[1].getByTestId('new-round').click();
  await waitForBothPhase('bidding', round);
  await Promise.all(pages.map((page, index) => assertNoOverflow(page, `Ready for round ${round}, ${report.players[index].name}`)));
}

try {
  if (process.env.FIXTURE_BASE_URL) await verifyAnnouncementFixtures(process.env.FIXTURE_BASE_URL);
  await Promise.all(pages.map(page => page.goto(baseURL, { waitUntil: 'networkidle' })));
  await inspectCardImages(pages[0].locator('.landing'), 'Landing decorative cards');
  await verifyDeckGallery(pages[1]);
  await assertNoOverflow(pages[0], 'Mobile landing page');
  await screenshot(pages[0], 'landing-mobile.png');
  await checkNarrowPhone(pages[0], 'landing-small-mobile.png');
  await pages[0].getByTestId('player-name').fill('Ana');
  await pages[0].getByTestId('create-room').click();
  await pages[0].getByTestId('room-code').waitFor();
  const roomCode = (await pages[0].getByTestId('room-code').textContent()).trim();
  assert.ok(roomCode, 'Creating a room must display an invitation code.');
  report.roomCode = roomCode;
  await inspectCardImages(pages[0].locator('.waiting-page'), 'Invitation card backs');
  await screenshot(pages[0], 'invitation-mobile.png');
  await pages[1].goto(`${baseURL}/?room=${encodeURIComponent(roomCode)}`, { waitUntil: 'networkidle' });
  assert.equal(await pages[1].getByTestId('join-code').inputValue(), roomCode,
    'Opening an invitation link must prefill the room code.');
  await pages[1].getByTestId('join-name').fill('Luka');
  await pages[1].getByTestId('join-room').click();
  log(`Ana invited Luka into room ${roomCode}; browsers have isolated session storage.`);

  await playRound(1, true);
  await readyForNextRound(2);
  await playRound(2, false);
  await readyForNextRound(3);
  await screenshot(pages[0], 'ready-round-3.png');
  await screenshot(pages[1], 'ready-round-3-tablet.png');
  await Promise.all(pages.map((page, index) => inspectCardImages(page.locator(gameSelector), `Ready for round 3, ${report.players[index].name}`)));
  await pages[1].locator('.score-button').click();
  assert.equal(await pages[1].getByTestId('scoreboard-row').count(), 2,
    'The third-round scoreboard modal must retain both completed rounds.');
  await screenshot(pages[1], 'round-3-scoreboard-history.png');
  await pages[1].getByRole('button', { name: 'Zapri', exact: true }).click();
  report.finalStates = await Promise.all(pages.map(snapshot));
  assert.ok(report.finalStates.every(state => state.round === 3 && state.phase === 'bidding'),
    'Both players should be ready to bid for their third round.');
  assert.equal(report.browserErrors.length, 0, `Browser errors: ${JSON.stringify(report.browserErrors)}`);
  assert.ok(report.optionalPickups.some(pickup => pickup.offTurn), 'At least one exposed honor must be taken explicitly while the opponent is on turn.');
  assert.ok(hasDelayedPickup(), 'After the first pickup, another honor must remain exposed for at least two actual plays before being taken.');
  assert.ok(report.directHonorPlays.length > 0, 'Other exposed honors must be left on their stacks and played normally without taking them into the hand.');
  assert.deepEqual([...verifiedGameCardIds].sort(), [...cardsById.keys()].sort(),
    'Real gameplay must exercise all 54 distinct scanned card faces.');
  report.gameCardImagesVerified = [...verifiedGameCardIds].sort();
  report.passed = true;
  log('PASS: two complete rounds, shared scoreboards, responsive layouts, and both players ready for round 3.');
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  report.failureStates = await Promise.all(pages.map(page => snapshot(page).catch(() => null)));
  await Promise.all(pages.map((page, index) => screenshot(page, `failure-${index + 1}.png`).catch(() => {})));
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, 'browser-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (keepBrowserOpen && report.passed) {
    log(`Browser windows kept open in room ${report.roomCode}, ready for round 3. Close the browser to exit.`);
    await pages[0].bringToFront();
    await new Promise(resolve => browser.once('disconnected', resolve));
  } else {
    await browser.close();
  }
}
