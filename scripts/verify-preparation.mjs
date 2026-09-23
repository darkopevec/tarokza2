// Reproduce preparation through real browser input against disposable data only.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/preparation');
const report = { startedAt: new Date().toISOString(), cases: [], layouts: [], screenshots: [], browserErrors: [] };
const viewports = [
  { width: 1440, height: 900, touch: false },
  { width: 630, height: 680, touch: false },
  { width: 390, height: 844, touch: true },
  { width: 320, height: 568, touch: true },
  { width: 568, height: 320, touch: true },
  { width: 1024, height: 768, touch: true },
];
const firstHonors = ['tarok-22', 'tarok-19'];
const secondHonors = ['tarok-21', 'tarok-18'];
let fixtureDealer = 0;

function fixture(options) {
  const game = engine.createGame({ ...options, dealer: fixtureDealer, rng: () => 0.37 });
  const stackIds = [
    [['tarok-22', 'tarok-21', 'clubs-8', 'clubs-1'],
      ['hearts-8', 'hearts-1', 'hearts-2', 'hearts-3'],
      ['spades-1', 'tarok-20', 'spades-2', 'spades-3']],
    [['tarok-19', 'tarok-18', 'diamonds-8', 'diamonds-1'],
      ['spades-8', 'spades-4', 'spades-5', 'spades-6'],
      ['diamonds-2', 'tarok-17', 'diamonds-3', 'diamonds-4']],
  ];
  const deck = engine.createDeck();
  const byId = new Map(deck.map(card => [card.id, card]));
  const inStacks = new Set(stackIds.flat(2));
  const remaining = deck.filter(card => !inStacks.has(card.id));
  game.players.forEach((player, seat) => {
    player.hand = remaining.slice(seat * 15, (seat + 1) * 15);
    player.stacks = stackIds[seat].map(stack => stack.map(id => byId.get(id)));
  });
  assert.deepEqual(game.players.flatMap(player => [...player.hand, ...player.stacks.flat()])
    .map(card => card.id).sort(), deck.map(card => card.id).sort(), 'Fixture must contain the full unique deck.');
  const prepared = structuredClone(game);
  engine.act(prepared, prepared.players[1 - prepared.dealer].id, { type: 'bid', bid: 'play' });
  assert.equal(engine.preparationTurn(prepared), 1 - prepared.dealer);
  for (const player of prepared.players) {
    assert.deepEqual(engine.legalAnnouncements(prepared, player.id), [], 'Neither seat starts with an eligible announcement.');
    assert.equal(player.hand.length, 15);
    assert.deepEqual(player.stacks.map(stack => stack.length), [4, 4, 4]);
  }
  return game;
}

async function snapshot(page) {
  return page.locator('.game-page').evaluate(game => ({
    phase: game.dataset.phase,
    you: Number(game.dataset.you),
    turn: Number(game.dataset.turn),
    trickNumber: Number(game.dataset.trickNumber),
    trickCards: game.dataset.trickCardIds,
    pickups: Number(game.dataset.pickupCount),
    ready: game.dataset.announcementReady.split(',').map(value => value === 'true'),
    hand: [...game.querySelectorAll('.hand-panel [data-testid="play-card"]')].map(card => card.dataset.cardId).sort(),
    stacks: [...game.querySelectorAll('.my-stacks .stack')].map(stack => ({
      count: Number(stack.dataset.stackCount), top: stack.dataset.topCardId,
    })),
  }));
}
async function phase(pages, value) {
  await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', value)));
}
async function input(locator, touch) {
  // tap/click performs Playwright's normal hit testing; no force or DOM dispatch.
  await expect(locator).toBeEnabled();
  await locator.click({ trial: true });
  if (!await locator.evaluate(element => element.classList.contains('playing-card'))) {
    const reachable = await locator.evaluate(element => {
      const r = element.getBoundingClientRect();
      return [[r.width / 2, r.height / 2], [4, 4], [r.width - 4, 4],
        [4, r.height - 4], [r.width - 4, r.height - 4]]
        .every(([x, y]) => element.contains(document.elementFromPoint(r.x + x, r.y + y)));
    });
    assert.ok(reachable, 'The center and all four inner corners of the action must receive input.');
  }
  if (touch) await locator.tap(); else await locator.click();
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(artifacts, name), fullPage: true, animations: 'disabled' });
  report.screenshots.push(name);
}
async function inspectOrdering(pages, label) {
  for (const [seat, page] of pages.entries()) {
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing table region: ${selector}`);
        const r = element.getBoundingClientRect();
        return { top: r.top + scrollY, bottom: r.bottom + scrollY, width: r.width, height: r.height };
      };
      return { opponent: rect('.opponent-stacks'), center: rect('.center-play'),
        own: rect('.my-stacks'), hand: rect('.hand-panel'),
        viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    for (const key of ['opponent', 'center', 'own', 'hand']) {
      assert.ok(layout[key].height > 0 && layout[key].width > 0, `${label}, seat ${seat}: ${key} region is present.`);
    }
    assert.ok(layout.opponent.bottom <= layout.center.top + 1,
      `${label}, seat ${seat}: opponent piles belong above the center controls/trick. ${JSON.stringify(layout)}`);
    assert.ok(layout.center.bottom <= layout.own.top + 1,
      `${label}, seat ${seat}: own piles belong below the center controls/trick. ${JSON.stringify(layout)}`);
    assert.ok(layout.own.bottom <= layout.hand.top + 1,
      `${label}, seat ${seat}: own piles belong above the hand. ${JSON.stringify(layout)}`);
    assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `${label}, seat ${seat}: no horizontal page overflow.`);
    // Vertical scrolling is intentional for small and tiled windows.
    report.layouts.push({ label, seat, ...layout });
  }
}
async function pickup(pages, seat, cardId, touch) {
  const before = await Promise.all(pages.map(snapshot));
  const option = pages[seat].getByTestId('pickup-card').and(pages[seat].locator(`[data-card-id="${cardId}"]`));
  const stackIndex = Number(await option.getAttribute('data-stack-index'));
  const bounds = await option.boundingBox();
  assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, 'Pickup has a separate 44px touch target.');
  await input(option, touch);
  await Promise.all(pages.map(page => expect(page.locator('.game-page'))
    .toHaveAttribute('data-pickup-count', String(before[seat].pickups + 1))));
  const after = await Promise.all(pages.map(snapshot));
  assert.deepEqual(after[seat].hand, [...before[seat].hand, cardId].sort(), 'One input takes exactly one card.');
  assert.deepEqual(after[1 - seat].hand, before[1 - seat].hand, 'The other hand remains unchanged.');
  assert.equal(after[seat].stacks[stackIndex].count, before[seat].stacks[stackIndex].count - 1);
  for (const index of [0, 1]) {
    for (const key of ['turn', 'trickNumber', 'trickCards', 'phase', 'ready']) {
      assert.deepEqual(after[index][key], before[index][key], `Pickup preserves ${key} for both players.`);
    }
  }
  return after[seat];
}

let dataDir, server, browser;
let activePages = [];
await mkdir(artifacts, { recursive: true });
try {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-preparation-'));
  server = await createTarokServer({ dataDir, engine: { ...engine, createGame: fixture } });
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch {} }
  browser = await chromium.launch({ headless: process.env.HEADLESS !== '0', ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const viewport of viewports) for (const starter of [0, 1]) {
    fixtureDealer = 1 - starter;
    const readySeat = starter;
    const preparingSeat = fixtureDealer;
    const label = `${viewport.width}x${viewport.height}-starter-${starter}`;
    const contexts = await Promise.all([0, 1].map(() => browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.touch, hasTouch: viewport.touch,
    })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    activePages = pages;
    pages.forEach(page => {
      page.setDefaultTimeout(10_000);
      page.on('pageerror', error => report.browserErrors.push({ label, message: error.message }));
    });
    await pages[0].goto(url, { waitUntil: 'networkidle' });
    if (await pages[0].getByTestId('player-name').count()) await pages[0].getByTestId('player-name').fill('Ana');
    await input(pages[0].getByTestId('create-room'), viewport.touch);
    await pages[0].getByTestId('room-code').waitFor();
    const room = (await pages[0].getByTestId('room-code').textContent()).trim();
    await pages[1].goto(await pages[0].getByRole('textbox', { name: 'Povabilo za prijatelja', exact: true }).inputValue(), { waitUntil: 'networkidle' });
    if (await pages[1].getByTestId('player-name').count()) await pages[1].getByTestId('player-name').fill('Luka');
    await input(pages[1].getByTestId('join-room'), viewport.touch);
    await phase(pages, 'bidding');
    assert.deepEqual((await Promise.all(pages.map(snapshot))).map(state => state.you), [0, 1], 'Players use different seats.');
    await inspectOrdering(pages, `${label}-bidding`);
    await input(pages[starter].getByTestId('bid-play'), viewport.touch);
    await phase(pages, 'announcements');
    await inspectOrdering(pages, `${label}-after-bid`);
    for (const page of pages) for (const bonus of ['kings', 'trula', 'valat']) {
      await expect(page.getByTestId(`announce-${bonus}`)).toBeDisabled();
    }
    await expect(pages[starter].getByTestId('confirm-announcements')).toBeEnabled();
    await expect(pages[preparingSeat].getByTestId('confirm-announcements')).toBeDisabled();
    await expect(pages[preparingSeat].getByTestId('pickup-card').first()).toBeEnabled();
    // Waiting for the starter's confirmation must not lock the dealer's pickups.
    await pickup(pages, preparingSeat, ['hearts-8', 'spades-8'][preparingSeat], viewport.touch);
    await expect(pages[preparingSeat].getByTestId('confirm-announcements')).toBeDisabled();
    await input(pages[readySeat].getByTestId('confirm-announcements'), viewport.touch);
    const readiness = [readySeat === 0, readySeat === 1].join(',');
    await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-announcement-ready', readiness)));
    await expect(pages[readySeat].getByTestId('confirm-announcements')).toBeDisabled();
    await expect(pages[preparingSeat].getByTestId('confirm-announcements')).toBeEnabled();
    await expect(pages[readySeat].getByTestId('pickup-card')).toHaveCount(0);
    await expect(pages[preparingSeat].getByTestId('preparation-status')).toBeVisible();
    for (const page of pages) await expect(page.locator('[data-testid="play-card"]:enabled')).toHaveCount(0);
    await inspectOrdering(pages, `${label}-starter-ready`);
    await capture(pages[preparingSeat], `${label}-other-ready.png`);
    await expect(pages[preparingSeat].getByTestId('prep-pickup-reminder')).toHaveCount(0);

    const afterFirst = await pickup(pages, preparingSeat, firstHonors[preparingSeat], viewport.touch);
    assert.equal(afterFirst.stacks[0].top, secondHonors[preparingSeat], 'The next honor is exposed without automatic pickup.');
    assert.ok(!afterFirst.hand.includes(secondHonors[preparingSeat]));
    await expect(pages[preparingSeat].locator(`[data-testid="pickup-card"][data-card-id="${secondHonors[preparingSeat]}"]`)).toBeEnabled();
    await pages[preparingSeat].reload({ waitUntil: 'networkidle' });
    await phase(pages, 'announcements');
    assert.deepEqual(await snapshot(pages[preparingSeat]), afterFirst, 'Refresh restores the unready seat and exact preparation.');
    await pickup(pages, preparingSeat, secondHonors[preparingSeat], viewport.touch);
    while (await pages[preparingSeat].getByTestId('pickup-card').count()) {
      const id = await pages[preparingSeat].getByTestId('pickup-card').first().getAttribute('data-card-id');
      await pickup(pages, preparingSeat, id, viewport.touch);
    }
    await expect(pages[preparingSeat].getByTestId('pickup-empty')).toBeVisible();
    await expect(pages[preparingSeat].getByTestId('confirm-announcements')).toBeEnabled();
    await expect(pages[preparingSeat].getByTestId('prep-pickup-reminder')).toHaveCount(0);
    await capture(pages[preparingSeat], `${label}-no-pickups.png`);

    // A second tab in one browser restores that browser's existing seat.
    if (viewport.width === 1440 && readySeat === 0) {
      const duplicate = await contexts[readySeat].newPage();
      await duplicate.goto(`${url}/?room=${room}`, { waitUntil: 'networkidle' });
      await phase([duplicate], 'announcements');
      assert.equal((await snapshot(duplicate)).you, readySeat);
      await expect(duplicate.getByTestId('confirm-announcements')).toBeDisabled();
      await duplicate.close();
      report.sameBrowserTabResumesExistingSeat = true;
    }

    await input(pages[preparingSeat].getByTestId('confirm-announcements'), viewport.touch);
    await phase(pages, 'playing');
    await inspectOrdering(pages, `${label}-playing`);
    // The confirmed player regains optional pickups when actual play begins.
    await pickup(pages, readySeat, firstHonors[readySeat], viewport.touch);
    const leader = (await snapshot(pages[0])).turn;
    assert.equal(leader, starter, 'The player who confirmed first leads the first trick.');
    const lead = pages[leader].locator('[data-testid="play-card"]:enabled').first();
    const leadId = await lead.getAttribute('data-card-id');
    await input(lead, viewport.touch);
    await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-trick-card-ids', leadId)));
    await input(pages[1 - leader].locator('[data-testid="play-card"]:enabled').first(), viewport.touch);
    await Promise.all(pages.map(page => expect(page.locator('.game-page')).toHaveAttribute('data-trick-number', '2')));
    await inspectOrdering(pages, `${label}-first-trick`);
    for (const page of pages) {
      const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
      assert.ok(dimensions.document <= dimensions.width + 1, `${label}: no horizontal page overflow.`);
    }
    await capture(pages[preparingSeat], `${label}-first-trick.png`);
    report.cases.push({ label, starter, dealer: preparingSeat, readySeat, preparingSeat, input: viewport.touch ? 'tap' : 'click',
      starterConfirmsFirst: true, dealerCanPickUpBeforeStarterConfirms: true, verticalTableOrder: true,
      refresh: true, separateHonorPickups: true, zeroPickups: true, firstTrick: true, passed: true });
    console.log(`PASS ${label}: starter-first confirmation, dealer pickups before/after, vertical table order, refresh, and first trick.`);
    await Promise.all(contexts.map(context => context.close()));
    activePages = [];
  }
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  report.failureStates = await Promise.all(activePages.map(page => snapshot(page).catch(() => null)));
  await Promise.all(activePages.map((page, index) => capture(page, `failure-${index}.png`).catch(() => {})));
  process.exitCode = 1;
  console.error(error.stack);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
