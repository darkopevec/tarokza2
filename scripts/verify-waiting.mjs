// Exercise invitation controls against disposable local rooms only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createTarokServer } from '../server/index.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts/waiting');
const viewports = [
  { width: 320, height: 568, touch: true },
  // Approximate the available page area after Safari's phone browser controls.
  { width: 390, height: 664, touch: true },
  { width: 430, height: 740, touch: true },
  { width: 1024, height: 768, touch: false },
];
const report = { startedAt: new Date().toISOString(), cases: [], layouts: [], screenshots: [], browserErrors: [] };
let dataDir, server, browser;
let activePages = [];

async function capture(page, filename) {
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true, animations: 'disabled' });
  report.screenshots.push(filename);
}

async function roomSnapshot(code) {
  return JSON.parse(await readFile(path.join(dataDir, `${code}.json`), 'utf8'));
}

function assertOnlyInvitationChanged(before, after, label) {
  const { invitationHash: previousInvitation, ...previousRoom } = before;
  const { invitationHash: currentInvitation, ...currentRoom } = after;
  assert.notEqual(currentInvitation, previousInvitation, `${label}: invitation secret rotates`);
  assert.deepEqual(currentRoom, previousRoom, `${label}: table, seat, and game remain unchanged`);
}

async function input(locator, touch) {
  await expect(locator).toBeEnabled();
  await locator.click({ trial: true });
  if (touch) await locator.tap(); else await locator.click();
}

async function inspectLayout(page, label, { primaryAboveFold = false } = {}) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const box = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const controls = [...document.querySelectorAll('.site-header button, .site-header select, .waiting-page button, .waiting-page summary, .waiting-page input')]
      .filter(element => {
        // Chromium may retain a layout box for the contents of closed details.
        const closed = element.closest('details:not([open])');
        return !closed || closed.querySelector(':scope > summary') === element;
      })
      .filter(element => element.getClientRects().length && box(element).width > 0 && box(element).height > 0)
      .map(element => ({ label: element.getAttribute('data-testid') || element.getAttribute('aria-label') || element.textContent.trim(),
        tag: element.tagName, region: element.closest('.site-header') ? 'header' : 'waiting', ...box(element) }));
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      headerBottom: box(document.querySelector('.site-header')).bottom,
      controls, primary: ['invite-share', 'invite-copy', 'invite-generate'].map(id => {
        const element = document.querySelector(`[data-testid="${id}"]`);
        return element && { label: id, ...box(element) };
      }).filter(Boolean) };
  });
  report.layouts.push({ label, ...layout });
  assert.ok(layout.documentWidth <= layout.width + 1, `${label}: no horizontal page overflow`);
  for (const control of layout.controls) {
    assert.ok(control.left >= -1 && control.right <= layout.width + 1,
      `${label}: ${control.label} fits the page width (${JSON.stringify(control)})`);
    assert.ok(control.width >= 43.5 && control.height >= 43.5,
      `${label}: ${control.label} keeps a 44px target (${control.width} × ${control.height})`);
  }
  for (let i = 0; i < layout.controls.length; i++) {
    for (let j = i + 1; j < layout.controls.length; j++) {
      const a = layout.controls[i], b = layout.controls[j];
      // The waiting region scrolls beneath the persistent header. Offscreen
      // content boxes can intersect its coordinates without painted overlap.
      if (a.region !== b.region) continue;
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      assert.ok(overlapWidth <= 1 || overlapHeight <= 1,
        `${label}: controls ${a.label} and ${b.label} do not overlap`);
    }
  }
  if (primaryAboveFold) {
    assert.ok(layout.primary.length > 0, `${label}: invitation action is present`);
    for (const control of layout.primary) {
      assert.ok(control.top >= layout.headerBottom && control.bottom <= layout.height + 1,
        `${label}: ${control.label} is visible without scrolling (${JSON.stringify(control)})`);
    }
  }
}

async function createContext(viewport, { shareSupported = true } = {}) {
  const context = await browser.newContext({ locale: 'sl-SI',
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.touch, hasTouch: viewport.touch,
  });
  await context.addInitScript(({ shareSupported }) => {
    localStorage.setItem('tarokza2.language', 'sl');
    window.waitingVerification = { copies: [], shares: [], clipboardFailure: false, shareFailure: '' };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => {
        if (window.waitingVerification.clipboardFailure) throw new DOMException('Clipboard unavailable', 'NotAllowedError');
        window.waitingVerification.copies.push(value);
      },
    } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareSupported ? async data => {
      if (window.waitingVerification.shareFailure) throw new DOMException('Share unavailable', window.waitingVerification.shareFailure);
      window.waitingVerification.shares.push(data);
    } : undefined });
  }, { shareSupported });
  return context;
}

await mkdir(artifacts, { recursive: true });
try {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-waiting-'));
  server = await createTarokServer({ dataDir });
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const viewport of viewports) {
    const label = `${viewport.width}x${viewport.height}`;
    const hostContext = await createContext(viewport);
    const guestContext = await createContext(viewport);
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    activePages = [host, guest];
    for (const page of activePages) {
      page.setDefaultTimeout(10_000);
      page.on('pageerror', error => report.browserErrors.push({ label, message: error.message }));
    }

    await host.goto(origin);
    await host.getByTestId('player-name').fill('Ana Marija Novak');
    await input(host.getByTestId('create-room'), viewport.touch);
    const waiting = host.locator('.waiting-page');
    await expect(waiting).toBeVisible();
    await expect(host.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{6}$/);
    const room = (await host.getByTestId('room-code').textContent()).trim();
    const createdRoom = await roomSnapshot(room);
    const invitationField = host.locator('.waiting-page .invite-url');
    await expect(invitationField).toHaveValue(new RegExp(`${origin}/#invite=`));
    const firstInvitation = await invitationField.inputValue();
    const details = host.getByTestId('invite-details');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(waiting.getByText('Ana Marija Novak', { exact: true }).first()).toBeVisible();
    await expect(waiting.getByText('Čakamo prijatelja', { exact: true }).first()).toBeVisible();
    await inspectLayout(host, `${label} created`, { primaryAboveFold: true });
    await capture(host, `${label}-invitation.png`);

    await input(host.getByTestId('invite-share'), viewport.touch);
    await expect.poll(() => host.evaluate(() => window.waitingVerification.shares.length)).toBe(1);
    assert.equal(await host.evaluate(() => window.waitingVerification.shares[0].url), firstInvitation,
      'Native sharing receives the invitation URL');
    if (viewport.width === 390) {
      await host.evaluate(() => { window.waitingVerification.shareFailure = 'AbortError'; });
      await input(host.getByTestId('invite-share'), viewport.touch);
      assert.equal(await host.evaluate(() => window.waitingVerification.copies.length), 0,
        'Cancelling native sharing does not unexpectedly copy a private invitation');
      await expect(host.getByRole('alert')).toHaveCount(0);
      await host.evaluate(() => { window.waitingVerification.shareFailure = ''; });
      report.shareCancellationPreservesClipboard = true;
    }
    if (viewport.width === 430) {
      await host.evaluate(() => { window.waitingVerification.shareFailure = 'NotAllowedError'; });
      await input(host.getByTestId('invite-share'), viewport.touch);
      await expect(host.getByTestId('invite-copy')).toContainText('Kopirano');
      assert.equal(await host.evaluate(() => window.waitingVerification.copies.at(-1)), firstInvitation,
        'An unavailable native share sheet falls back to copying the same invitation');
      await host.evaluate(() => { window.waitingVerification.shareFailure = ''; });
      report.failedNativeSharingFallsBackToCopy = true;
    }
    await input(host.getByTestId('invite-copy'), viewport.touch);
    await expect(host.getByTestId('invite-copy')).toContainText('Kopirano');
    assert.equal(await host.evaluate(() => window.waitingVerification.copies.at(-1)), firstInvitation,
      'Copy receives the same invitation URL');
    assert.deepEqual(await roomSnapshot(room), createdRoom, 'Sharing and copying preserve the invitation');

    await host.reload();
    await expect(host.getByTestId('room-code')).toHaveText(room);
    await expect(host.getByTestId('invite-generate')).toBeVisible();
    await expect(invitationField).toHaveCount(0);
    assert.deepEqual(await roomSnapshot(room), createdRoom, 'Reload resumes the room without invalidating the previous invitation');
    await inspectLayout(host, `${label} resumed`, { primaryAboveFold: true });
    await capture(host, `${label}-resumed.png`);

    await input(host.getByTestId('invite-generate'), viewport.touch);
    await expect(invitationField).toHaveValue(new RegExp(`${origin}/#invite=`));
    const generatedInvitation = await invitationField.inputValue();
    assert.notEqual(generatedInvitation, firstInvitation);
    const generatedRoom = await roomSnapshot(room);
    assertOnlyInvitationChanged(createdRoom, generatedRoom, 'Explicit creation after reload');
    await expect(host.getByTestId('invite-copy')).not.toContainText('Kopirano');
    await inspectLayout(host, `${label} regenerated`, { primaryAboveFold: true });

    await input(details.locator('summary'), viewport.touch);
    await expect(details).toHaveAttribute('open', '');
    await expect(host.getByAltText('QR: Povabilo za prijatelja')).toBeVisible();
    await expect(invitationField).toBeVisible();
    await inspectLayout(host, `${label} expanded QR`);
    await capture(host, `${label}-qr.png`);
    await input(details.locator('summary'), viewport.touch);
    await expect(details).not.toHaveAttribute('open', '');

    // A browser denying clipboard permission must focus the selectable URL.
    await host.evaluate(() => { window.waitingVerification.clipboardFailure = true; });
    await input(host.getByTestId('invite-copy'), viewport.touch);
    await expect(details).not.toHaveAttribute('open', '');
    await expect(invitationField).toBeFocused();
    assert.deepEqual(await invitationField.evaluate(element => [element.selectionStart, element.selectionEnd]),
      [0, generatedInvitation.length], 'Clipboard fallback selects the complete invitation');
    await expect(host.getByTestId('invite-copy')).not.toContainText('Kopirano');
    await host.evaluate(() => { window.waitingVerification.clipboardFailure = false; });

    await input(host.getByTestId('waiting-recovery'), viewport.touch);
    await expect(host.getByRole('dialog')).toBeVisible();
    await expect(host.getByRole('dialog').getByRole('button', { name: 'Ustvari novo obnovitveno povezavo', exact: true })).toBeVisible();
    await input(host.getByRole('dialog').getByRole('button', { name: 'Zapri', exact: true }), viewport.touch);
    assert.deepEqual(await roomSnapshot(room), generatedRoom, 'Opening recovery settings preserves this room and invitation');

    await input(host.locator('.invitation-replace summary'), viewport.touch);
    await expect(host.locator('.invitation-replace')).toHaveAttribute('open', '');
    await expect(host.locator('.invitation-replace')).toContainText('Novo povabilo razveljavi prejšnje.');
    await inspectLayout(host, `${label} replace invitation expanded`);
    await input(host.getByTestId('invite-regenerate'), viewport.touch);
    await expect(invitationField).not.toHaveValue(generatedInvitation);
    const currentInvitation = await invitationField.inputValue();
    const regeneratedRoom = await roomSnapshot(room);
    assertOnlyInvitationChanged(generatedRoom, regeneratedRoom, 'Invitation regeneration');
    await expect(host.getByTestId('room-code')).toHaveText(room);
    await guest.goto(generatedInvitation);
    await guest.getByTestId('player-name').fill('Luka');
    await input(guest.getByTestId('join-room'), viewport.touch);
    await expect(guest.getByRole('alert')).toContainText('Povabilo ni veljavno ali je že uporabljeno.');
    await expect(waiting).toBeVisible();
    assert.deepEqual(await roomSnapshot(room), regeneratedRoom, 'A replaced invitation cannot consume the empty seat');

    await guest.goto(currentInvitation);
    await input(guest.getByTestId('join-room'), viewport.touch);
    await Promise.all([host, guest].map(page => expect(page.locator('.game-page')).toHaveAttribute('data-phase', 'bidding')));
    const joinedRoom = await roomSnapshot(room);
    assert.equal(joinedRoom.id, room);
    assert.deepEqual(joinedRoom.players.map(player => player.name), ['Ana Marija Novak', 'Luka']);
    assert.equal(joinedRoom.players[0].id, createdRoom.players[0].id);
    assert.equal(joinedRoom.invitationHash, undefined, 'Joining consumes the invitation');
    assert.ok(joinedRoom.game, 'The table starts automatically with both players present');
    report.cases.push({ label, share: true, copy: true, clipboardFallback: true, qr: true, resumedWithoutRotation: true,
      explicitRegeneration: true, staleInvitationRejected: true, secondPlayerStartsGame: true, passed: true });
    console.log(`PASS ${label}: invitation controls, QR, clipboard fallback, resume, replacement, and second player joining.`);
    await Promise.all([hostContext.close(), guestContext.close()]);
    activePages = [];
  }

  // Browsers without Web Share still provide the invitation through Copy.
  {
    const viewport = viewports[1];
    const context = await createContext(viewport, { shareSupported: false });
    const page = await context.newPage();
    activePages = [page];
    page.on('pageerror', error => report.browserErrors.push({ label: 'without Web Share', message: error.message }));
    await page.goto(origin);
    await page.getByTestId('player-name').fill('Maja');
    await input(page.getByTestId('create-room'), viewport.touch);
    await expect(page.getByTestId('room-code')).toBeVisible();
    await expect(page.getByTestId('invite-share')).toHaveCount(0);
    const url = await page.locator('.waiting-page .invite-url').inputValue();
    await input(page.getByTestId('invite-copy'), viewport.touch);
    await expect(page.getByTestId('invite-copy')).toContainText('Kopirano');
    assert.equal(await page.evaluate(() => window.waitingVerification.copies.at(-1)), url);
    await inspectLayout(page, 'without native sharing', { primaryAboveFold: true });
    report.cases.push({ label: 'without native sharing', copyAvailable: true, passed: true });
    await context.close();
    activePages = [];
    console.log('PASS without Web Share: invitation can be copied.');
  }

  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
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
