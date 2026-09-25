import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox, expect } from '@playwright/test';
import * as engine from '../shared/game.mjs';
import { createTarokServer } from '../server/index.mjs';
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-fast-play-'));
const server = await createTarokServer({ dataDir, engine: { ...engine, createGame(options) {
  const game = engine.createGame({...options, dealer:1});
  const deck = engine.createDeck();
  const mond = deck.splice(deck.findIndex(c=>c.id==='tarok-21'),1)[0];
  const skis = deck.splice(deck.findIndex(c=>c.id==='tarok-22'),1)[0];
  game.players[0].hand = [mond,...deck.splice(0,14)];
  game.players[1].hand = [skis,...deck.splice(0,14)];
  for(const p of game.players) p.stacks=[deck.splice(0,4),deck.splice(0,4),deck.splice(0,4)];
  [game.players[0].stacks[0][0], game.players[0].stacks[1][3]] = [game.players[0].stacks[1][3], game.players[0].stacks[0][0]];
  game.phase='playing'; game.turn=0;
  return game;
}}});
const address=await server.listen(0,'127.0.0.1');
const origin=`http://127.0.0.1:${address.port}`;
const browser = await (process.env.BROWSER === 'firefox' ? firefox : chromium).launch(process.env.BROWSER === 'firefox' ? {} : {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH});
try {
 for(const [width,height] of [[390,844],[568,320]]) {
  const contexts=await Promise.all([0,1].map(()=>browser.newContext({ locale: 'sl-SI',viewport:{width,height}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  await pages[0].goto(origin); await pages[0].getByTestId('player-name').fill('Ana'); await pages[0].getByTestId('create-room').click();
  const invitation=await pages[0].getByRole('textbox',{name:'Povabilo za prijatelja',exact:true}).inputValue();
  await pages[1].goto(invitation); await pages[1].getByTestId('player-name').fill('Luka'); await pages[1].getByTestId('join-room').click();
  await expect(pages[0].locator('.game-page')).toHaveAttribute('data-phase','playing');
  await pages[0].locator('.hand-cards [data-card-id="tarok-21"]').click();
  const response = pages[1].locator('.hand-cards [data-card-id="tarok-22"]');
  await expect(response).toBeEnabled({timeout: 500});
  await response.click();
  await expect(pages[1].getByTestId('trick-collection')).toHaveCount(1);
  const nextLead = pages[1].locator('.hand-cards [data-testid="play-card"].legal').first();
  await expect(nextLead).toBeEnabled({timeout: 500});
  const nextId = await nextLead.getAttribute('data-card-id');
  await nextLead.click();
  await expect(pages[0].locator(`.game-table .played-card [data-card-id="${nextId}"]`)).toBeVisible({timeout: 500});
  const flight = pages[0].getByTestId('trick-collection');
  await expect(flight).toHaveCount(1);
  assert.deepEqual(await flight.locator('.playing-card').evaluateAll(cards => cards.map(card => card.dataset.cardId).sort()),
    ['tarok-21', 'tarok-22'], 'The collection keeps the completed cards, not the new lead');
  const reply = pages[0].locator('.hand-cards [data-testid="play-card"].legal').first();
  await expect(reply).toBeEnabled({timeout: 500});
  await reply.click();
  await expect(pages[0].locator('.game-page')).toHaveAttribute('data-trick-number', '3');
  await pages[0].waitForTimeout(3400);
  await expect(pages[0].getByTestId('trick-collection')).toHaveCount(0);
  console.log(`PASS ${width}x${height}: immediate response, immediate next lead, preserved collection animation`);
  await Promise.all(contexts.map(c=>c.close()));
 }
} finally {await browser.close(); await server.close(); await rm(dataDir,{recursive:true,force:true});}
