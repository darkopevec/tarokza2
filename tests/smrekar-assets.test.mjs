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

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Expected a JPEG image.');
  let offset = 2;
  while (offset + 8 < bytes.length) {
    assert.equal(bytes[offset], 0xff, 'Expected a JPEG segment marker.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'JPEG segment is complete.');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  assert.fail('JPEG has no image dimensions.');
}

test('Smrekar artwork has 41 corrected source faces, 13 reconstructed faces and its documented matching back', async () => {
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
      assert.equal(entry.adjusted, true, `${entry.id}: corrections are documented`);
      assert.deepEqual(jpegDimensions(bytes), { width: 504, height: 904 }, `${entry.id}: artwork fits the complete 63:113 frame`);
      assert.deepEqual({ width: entry.width, height: entry.height }, { width: 504, height: 904 }, `${entry.id}: recorded dimensions match the corrected JPEG`);
      assert.equal(entry.sourceScan.width, 500, `${entry.id}: original source width is retained`);
      assert.ok(entry.sourceScan.height > entry.sourceScan.width, `${entry.id}: original source dimensions are retained`);
      assert.ok(entry.sourceScan.bytes > 1_000, `${entry.id}: original source size is retained`);
      assert.match(entry.sourceScan.sha256, /^[a-f0-9]{64}$/, `${entry.id}: original source hash is retained`);
      assert.notEqual(entry.sourceScan.sha256, entry.sha256, `${entry.id}: original and corrected artwork have separate hashes`);
      assert.equal(new URL(entry.source).hostname, 'thumb.wikimedia.org');
      assert.equal(new URL(entry.original).hostname, 'upload.wikimedia.org');
      assert.equal(new URL(entry.description).hostname, 'commons.wikimedia.org');
      assert.match(entry.commonsFile, /^File:/);
      assert.equal(entry.license, 'Public domain');
      assert.equal(entry.licenseTemplate, 'PD-Art (PD-old-auto-expired)');
    }
  }));
});

test('Smrekar pip identities retain the three corrected source cards and every physical pip count on uniform white backgrounds', async () => {
  const atlasHash = digest(await readFile(new URL('suit-symbols.png', directory)));
  const symbolBySuit = new Map();
  for (const card of createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4)) {
    const entry = manifest.cards.find(entry => entry.id === card.id);
    const expectedPips = ['clubs', 'spades'].includes(card.suit) ? card.rank + 6 : 5 - card.rank;
    assert.equal(Number(card.label), expectedPips);
    assert.equal(entry.pipCount, expectedPips, `${card.id}: manifest records the physical rank`);
    if (sourcePips.includes(card.id)) {
      assert.ok(!entry.generated, `${card.id}: retain the source artwork`);
      assert.equal(entry.adjusted, true, `${card.id}: source artwork is corrected`);
      assert.equal(entry.file, `${card.id}.jpg`);
      continue;
    }
    assert.equal(entry.generated, true);
    const source = manifest.cards.find(source => source.file === entry.sourceCard);
    assert.ok(source && !source.generated && source.id.startsWith(`${card.suit}-`), `${card.id}: symbol comes from an original card in the same suit`);
    assert.equal(entry.symbolAtlasSha256, atlasHash);
    assert.equal(entry.background, '#ffffff', `${card.id}: requested white background is documented`);
    assert.deepEqual({ width: entry.width, height: entry.height }, { width: 200, height: 358 });
    const svg = await readFile(new URL(entry.file, directory), 'utf8');
    assert.match(svg, new RegExp(`data-card-id="${card.id}"`));
    assert.match(svg, new RegExp(`data-pips="${expectedPips}"`));
    assert.match(svg, new RegExp(`<title id="name">${card.name}</title>`));
    assert.match(svg, new RegExp(`viewBox="0 0 ${entry.width} ${entry.height}"`));
    const backgrounds = [...svg.matchAll(/<rect\b([^>]*)\/>/g)].map(match =>
      Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
    assert.equal(backgrounds.length, 1, `${card.id}: one uniform background`);
    assert.equal(Number(backgrounds[0].x ?? 0), 0);
    assert.equal(Number(backgrounds[0].y ?? 0), 0);
    assert.equal(Number(backgrounds[0].width), entry.width, `${card.id}: white background covers the full width`);
    assert.equal(Number(backgrounds[0].height), entry.height, `${card.id}: white background covers the full height`);
    assert.match(backgrounds[0].fill, /^#(?:fff|ffffff)$/i, `${card.id}: background is pure white`);
    assert.doesNotMatch(svg, /<(?:linearGradient|radialGradient)\b/i, `${card.id}: background has no gradient`);
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
