import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { createDeck } from '../shared/cards.mjs';

const directory = new URL('../public/cards/slovenian/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('Slovenian artwork has exactly one documented, intact face for all 54 playable identities', async () => {
  const expectedIds = createDeck().map(card => card.id).sort();
  assert.deepEqual(manifest.cards.map(card => card.id).sort(), expectedIds);
  assert.equal(manifest.cards.filter(card => !card.generated).length, 38);
  assert.equal(manifest.cards.filter(card => card.generated).length, 16);
  const files = (await readdir(directory)).filter(file => /\.(jpg|svg)$/.test(file));
  assert.deepEqual(files.sort(), manifest.cards.map(card => card.file).sort());
  await Promise.all(manifest.cards.map(async card => {
    const bytes = await readFile(new URL(card.file, directory));
    assert.equal(bytes.length, card.bytes, `${card.id}: documented size`);
    assert.equal(digest(bytes), card.sha256, `${card.id}: documented source hash`);
    assert.equal(new URL(card.source).origin, 'https://slovenski-tarok.si');
    assert.equal(card.width, 200);
    assert.equal(card.height, 358);
    if (!card.generated) assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255], `${card.id}: original JPEG`);
  }));
});

test('reconstructed pip faces show the correct physical rank and a self-contained suit symbol', async () => {
  const atlasHash = digest(await readFile(new URL('suit-symbols.png', directory)));
  const symbolBySuit = new Map();
  for (const card of createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4)) {
    const entry = manifest.cards.find(entry => entry.id === card.id);
    const svg = await readFile(new URL(entry.file, directory), 'utf8');
    // Tarok strength runs 7,8,9,10 for black suits and 4,3,2,1 for red suits.
    const expectedPips = ['clubs', 'spades'].includes(card.suit) ? card.rank + 6 : 5 - card.rank;
    assert.equal(Number(card.label), expectedPips);
    assert.equal(entry.pipCount, expectedPips);
    assert.equal(entry.sourceCard, `${card.suit}-8.jpg`);
    assert.equal(entry.symbolAtlasSha256, atlasHash);
    assert.match(svg, new RegExp(`data-card-id="${card.id}" data-pips="${expectedPips}"`));
    assert.match(svg, new RegExp(`<title id="name">${card.name}</title>`));
    assert.match(svg, /viewBox="0 0 200 358"/);
    const pips = [...svg.matchAll(/<use\b[^>]*data-pip="([^"]+)"[^>]*\/>/g)];
    assert.equal(pips.length, expectedPips, `${card.id}: visible pip count, not internal strength`);
    assert.ok(pips.every(pip => pip[1] === card.suit));
    assert.equal(new Set(pips.map(pip => pip[0].match(/transform="([^"]+)"/)[1])).size, expectedPips,
      `${card.id}: every pip occupies a distinct position`);
    const links = [...svg.matchAll(/\bhref="([^"]+)"/g)].map(match => match[1]);
    assert.ok(links.every(link => link === '#pip' || link.startsWith('data:image/png;base64,')),
      `${card.id}: artwork must render without external resources`);
    const embedded = links.filter(link => link.startsWith('data:'));
    assert.equal(embedded.length, 1);
    const png = Buffer.from(embedded[0].split(',')[1], 'base64');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const symbolHash = digest(png);
    if (symbolBySuit.has(card.suit)) assert.equal(symbolHash, symbolBySuit.get(card.suit));
    else symbolBySuit.set(card.suit, symbolHash);
    assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+\s*=/i);
  }
  assert.equal(new Set(symbolBySuit.values()).size, 4, 'Each suit uses its own extracted mark');
});
