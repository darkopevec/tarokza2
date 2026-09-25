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
  while (game.trickNumber < 27) {
    const id = game.players[game.turn].id;
    engine.act(game, id, { type: 'play', cardId: engine.legalMoves(game, id)[0] });
  }
  return game;
}}});
const address=await server.listen(0,'127.0.0.1');
const origin=`http://127.0.0.1:${address.port}`;
const browser = await (process.env.BROWSER === 'firefox' ? firefox : chromium).launch(process.env.BROWSER === 'firefox' ? {} : {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH});
try {
 for(const [width,height] of [[390,844],[568,320],[1440,900]]) {
  const contexts=await Promise.all([0,1].map(()=>browser.newContext({ locale: 'sl-SI',viewport:{width,height}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  await pages[0].goto(origin); await pages[0].getByTestId('player-name').fill('Ana'); await pages[0].getByTestId('create-room').click();
  const invitation=await pages[0].getByRole('textbox',{name:'Povabilo za prijatelja',exact:true}).inputValue();
  await pages[1].goto(invitation); await pages[1].getByTestId('player-name').fill('Luka'); await pages[1].getByTestId('join-room').click();
  await expect(pages[0].locator('.game-page')).toHaveAttribute('data-phase','playing');
  await expect(pages[0].getByTestId('trick-collection')).toHaveCount(0);
  const size=await pages[0].locator('.game-table .stack').first().evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}));
  for (let i = 0; i < 2; i++) {
    const active = await pages[0].locator('[data-testid="play-card"].legal').count() ? pages[0] : pages[1];
    await active.locator('[data-testid="play-card"].legal').first().click({ position: { x: 8, y: 8 } });
    if (i === 0) await expect(pages[0].locator('.game-page')).not.toHaveAttribute('data-trick-card-ids', '');
  }
  await expect(pages[0].getByTestId('trick-collection')).toHaveCount(1);
  const animated=await pages[0].locator('.trick-collection .playing-card').evaluateAll(cards=>cards.map(e=>({height:parseFloat(getComputedStyle(e).height),width:parseFloat(getComputedStyle(e).width)})));
  console.log('Sizes',width,size,animated);
  for(const card of animated) assert.ok(Math.abs(card.height-size.height)<2 && Math.abs(card.width-size.width)<2, 'Final-trick cards match table cards');
  await expect(pages[0].locator('.round-end')).toBeVisible({timeout: 5000});
  await pages[0].reload({waitUntil:'networkidle'});
  await pages[0].locator('.game-page').waitFor();
  assert.equal(await pages[0].locator('.game-table').count(),0);
  await expect(pages[0].locator('.round-end')).toBeVisible();
  console.log('PASS: final trick animates with empty piles; refreshed results open immediately');
  await Promise.all(contexts.map(c=>c.close()));
 }
} finally {await browser.close(); await server.close(); await rm(dataDir,{recursive:true,force:true});}
