import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { createDeck } from '../shared/cards.mjs';
import { cardBackImage, cardImage } from '../src/decks.mjs';

const directory = new URL('../public/cards/smrekar/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePips = ['clubs-1', 'diamonds-4', 'spades-1'];

test('Smrekar artwork has 41 intact source faces, 13 reconstructed faces and its documented matching back', async () => {
  const cards = createDeck();
  assert.deepEqual(manifest.cards.map(card => card.id).sort(), cards.map(card => card.id).sort());
  assert.equal(manifest.cards.filter(card => !card.generated).length, 41);
  assert.equal(manifest.cards.filter(card => card.generated).length, 13);
  assert.deepEqual(manifest.cards.filter(card => card.kind === 'pip' && !card.generated).map(card => card.id).sort(), sourcePips);
  assert.equal(manifest.back.id, 'back');
  assert.equal(cardBackImage('smrekar').split('?')[0], `/cards/smrekar/${manifest.back.file}`);
  const entries = [...manifest.cards, manifest.back];
  const files = (await readdir(directory)).filter(file => /\.(jpg|svg)$/.test(file));
  assert.deepEqual(files.sort(), entries.map(card => card.file).sort());
  await Promise.all(entries.map(async entry => {
    const bytes = await readFile(new URL(entry.file, directory));
    assert.equal(bytes.length, entry.bytes, `${entry.id}: documented size`);
    assert.equal(digest(bytes), entry.sha256, `${entry.id}: documented hash`);
    assert.ok(entry.width > 0 && entry.height > entry.width, `${entry.id}: documented portrait dimensions`);
    if (entry.id !== 'back') {
      assert.equal(cardImage(entry.id, 'smrekar').split('?')[0], `/cards/smrekar/${entry.file}`);
    }
    if (!entry.generated) {
      assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255], `${entry.id}: original JPEG`);
      assert.equal(entry.width, 500);
      assert.equal(new URL(entry.source).hostname, 'thumb.wikimedia.org');
      assert.equal(new URL(entry.original).hostname, 'upload.wikimedia.org');
      assert.equal(new URL(entry.description).hostname, 'commons.wikimedia.org');
      assert.match(entry.commonsFile, /^File:/);
      assert.equal(entry.license, 'Public domain');
      assert.equal(entry.licenseTemplate, 'PD-Art (PD-old-auto-expired)');
    }
  }));
});

test('Smrekar pip identities preserve all three original scans and every physical pip count', async () => {
  const atlasHash = digest(await readFile(new URL('suit-symbols.png', directory)));
  const symbolBySuit = new Map();
  for (const card of createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4)) {
    const entry = manifest.cards.find(entry => entry.id === card.id);
    const expectedPips = ['clubs', 'spades'].includes(card.suit) ? card.rank + 6 : 5 - card.rank;
    assert.equal(Number(card.label), expectedPips);
    assert.equal(entry.pipCount, expectedPips, `${card.id}: manifest records the physical rank`);
    if (sourcePips.includes(card.id)) {
      assert.ok(!entry.generated, `${card.id}: preserve the existing source scan`);
      assert.equal(entry.file, `${card.id}.jpg`);
      continue;
    }
    assert.equal(entry.generated, true);
    const source = manifest.cards.find(source => source.file === entry.sourceCard);
    assert.ok(source && !source.generated && source.id.startsWith(`${card.suit}-`), `${card.id}: symbol comes from an original card in the same suit`);
    assert.equal(entry.symbolAtlasSha256, atlasHash);
    const svg = await readFile(new URL(entry.file, directory), 'utf8');
    assert.match(svg, new RegExp(`data-card-id="${card.id}"`));
    assert.match(svg, new RegExp(`data-pips="${expectedPips}"`));
    assert.match(svg, new RegExp(`<title id="name">${card.name}</title>`));
    assert.match(svg, new RegExp(`viewBox="0 0 ${entry.width} ${entry.height}"`));
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
