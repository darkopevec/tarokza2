import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox, expect } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-hand-stability-'));
const server = await createTarokServer({ dataDir, ...(process.env.DIST_DIR ? { distDir: path.resolve(process.env.DIST_DIR) } : {}), engine: { ...engine, createGame(options) {
  const game = engine.createGame({...options, dealer:1});
  const deck = engine.createDeck();
  const mond = deck.splice(deck.findIndex(c=>c.id==='tarok-21'),1)[0];
  const skis = deck.splice(deck.findIndex(c=>c.id==='tarok-22'),1)[0];
  game.players[0].hand = [mond,...deck.splice(0,14)];
  game.players[1].hand = [skis,...deck.splice(0,14)];
  for(const p of game.players) p.stacks=[deck.splice(0,4),deck.splice(0,4),deck.splice(0,4)];
  // Include an available pickup, which adds a table overlay.
  [game.players[0].stacks[0][0], game.players[0].stacks[1][3]] = [game.players[0].stacks[1][3], game.players[0].stacks[0][0]];
  game.phase='playing'; game.turn=1;
  return game;
}}});
const address=await server.listen(0,'127.0.0.1');
const origin=`http://127.0.0.1:${address.port}`;
const browserName = process.env.BROWSER || 'chromium';
const browser = await (browserName === 'firefox' ? firefox : chromium).launch(browserName === 'firefox' ? {} : {executablePath: process.env.CHROMIUM_EXECUTABLE_PATH});
try {
 for(const [width,height] of [[320,568],[390,844],[568,320]]) {
  const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width,height}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  await pages[0].goto(origin); await pages[0].getByTestId('player-name').fill('Ana'); await pages[0].getByTestId('create-room').click();
  const invitation=await pages[0].getByRole('textbox',{name:'Povabilo za prijatelja',exact:true}).inputValue();
  await pages[1].goto(invitation); await pages[1].getByTestId('player-name').fill('Luka'); await pages[1].getByTestId('join-room').click();
  await expect(pages[0].locator('.game-page')).toHaveAttribute('data-phase','playing');
  await pages[0].waitForTimeout(300);
  const hand = pages[0].locator('.hand-scroll');
  await hand.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const geometry = () => hand.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: element.scrollLeft, top: rect.top, height: rect.height,
      cards: [...element.querySelectorAll('.playing-card')].map(card => {
        const r = card.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }) };
  });
  const before = await geometry();
  await pages[0].evaluate(() => {
    const page = document.querySelector('.game-page');
    const initial = page.style.getPropertyValue('--fitted-pile-height');
    window.handSizeChanges = [];
    // Detect temporary published sizes too: final geometry alone misses
    // resize probes that can disturb asynchronous mobile scrolling.
    new MutationObserver(records => {
      for (const record of records) {
        const previous = document.createElement('div');
        previous.setAttribute('style', record.oldValue || '');
        const size = previous.style.getPropertyValue('--fitted-pile-height');
        if (size !== initial) window.handSizeChanges.push(size);
      }
      const size = page.style.getPropertyValue('--fitted-pile-height');
      if (size !== initial) window.handSizeChanges.push(size);
    }).observe(page, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  });
  await pages[0].waitForTimeout(500);
  assert.deepEqual(await geometry(), before, 'Hand stays still while idle');
  await pages[1].locator('.hand-cards [data-card-id="tarok-22"]').click();
  await expect(pages[0].locator('.played-card')).toHaveCount(1);
  await pages[0].waitForTimeout(400);
  assert.deepEqual(await geometry(), before, 'Opponent play preserves all hand card positions and scroll');
  assert.deepEqual(await pages[0].evaluate(() => window.handSizeChanges), [],
    'Game updates do not publish temporary hand sizes');
  console.log(`${browserName} ${width}x${height}: idle and opponent play keep the hand still`);
  await Promise.all(contexts.map(c=>c.close()));
 }
} finally {await browser.close(); await server.close(); await rm(dataDir,{recursive:true,force:true});}
