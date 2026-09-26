import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDeck } from '../shared/cards.mjs';
import { cardBackImage, cardImage } from '../src/decks.mjs';

const canonical = createDeck();
const faceIds = canonical.map(card => card.id).sort();
const packs = ['modiano', 'moser', 'cego', 'neumayer'];
const directory = deck => deck === 'modiano' ? 'deck' : deck;
const asset = (deck, file) => readFileSync(new URL(`../public/cards/${directory(deck)}/${file}`, import.meta.url));
const manifest = deck => JSON.parse(asset(deck, 'sources.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const physicalPips = card => ['hearts', 'diamonds'].includes(card.suit) ? 5 - card.rank : card.rank + 6;

function jpegSize(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG signature');
  for (let offset = 2; offset + 8 < bytes.length;) {
    assert.equal(bytes[offset], 0xff, 'JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'JPEG segment length');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  throw new Error('JPEG dimensions are missing');
}

test('published collection faces resolve to 54 distinct, documented and intact assets per deck', async t => {
  for (const deck of packs) await t.test(deck, () => {
    const m = manifest(deck);
    const faces = m.cards.filter(card => card.id !== 'back');
    assert.deepEqual(faces.map(card => card.id).sort(), faceIds);
    assert.equal(faces.filter(card => card.kind === 'trump').length, 22);
    assert.equal(faces.filter(card => card.kind === 'court').length, 16);
    assert.equal(faces.filter(card => card.kind === 'pip').length, 16);
    assert.equal(new Set(faces.map(card => card.sha256)).size, 54, 'No duplicated substitute faces');
    for (const card of faces) {
      const served = new URL(cardImage(card.id, deck), 'https://tarok.invalid').pathname;
      assert.equal(served, `/cards/${directory(deck)}/${card.file}`);
      const bytes = asset(deck, card.file);
      assert.equal(bytes.length, card.bytes, `${deck}/${card.id}: byte count`);
      assert.equal(digest(bytes), card.sha256, `${deck}/${card.id}: artwork no longer matches provenance`);
      assert.ok(/^https?:$/.test(new URL(card.source).protocol), `${deck}/${card.id}: source URL`);
      if (card.file.endsWith('.jpg')) {
        assert.deepEqual(jpegSize(bytes), [card.width, card.height], `${deck}/${card.id}: recorded dimensions`);
        assert.deepEqual([card.width, card.height], [504, 904]);
        const originalHash = card.sourceScan?.sha256 ?? card.sourceSha256;
        assert.match(originalHash, /^[a-f0-9]{64}$/, `${deck}/${card.id}: original scan fingerprint`);
        assert.notEqual(originalHash, card.sha256, `${deck}/${card.id}: restoration provenance`);
      }
    }
    if (deck !== 'modiano') {
      assert.ok(m.back && m.back.id === 'back');
      assert.equal(new URL(cardBackImage(deck), 'https://tarok.invalid').pathname, `/cards/${deck}/${m.back.file}`);
      const bytes = asset(deck, m.back.file);
      assert.equal(digest(bytes), m.back.sha256);
      assert.deepEqual(jpegSize(bytes), [m.back.width, m.back.height]);
    }
  });
});

test('photographic pip sources retain the physical red and black rank conventions', () => {
  for (const deck of packs) {
    const m = manifest(deck);
    for (const card of canonical.filter(card => card.suit !== 'tarok' && card.rank <= 4)) {
      const source = m.cards.find(entry => entry.id === card.id);
      const expected = physicalPips(card);
      assert.equal(Number(card.label), expected);
      if (deck === 'modiano') {
        const filename = decodeURIComponent(new URL(source.source).pathname);
        assert.equal(Number(filename.match(/-(\d+)\.jpg$/)?.[1]), expected, `${card.id}: photograph rank`);
        const nativeSuit = { clubs: 'kreuz', spades: 'pik', hearts: 'herz', diamonds: 'karo' }[card.suit];
        assert.ok(filename.includes(`tarock-${nativeSuit}-`), `${card.id}: photograph suit`);
      } else {
        assert.equal(source.pipCount, expected, `${deck}/${card.id}: physical pip count`);
        if (!source.generated && !source.sourceObject) {
          const originalRank = new URL(source.source).pathname.match(/[shdc](A|\d+)\.jpg$/)?.[1];
          assert.equal(originalRank === 'A' ? 1 : Number(originalRank), expected, `${deck}/${card.id}: photograph rank`);
        }
      }
    }
  }
});

test('trump and court sources retain each pack’s catalogue rank and suit mapping', () => {
  for (const deck of packs) {
    const m = manifest(deck);
    for (const card of canonical.filter(card => card.suit === 'tarok' || card.rank >= 5)) {
      const record = m.cards.find(entry => entry.id === card.id);
      const sourcePath = decodeURIComponent(new URL(record.source).pathname);
      let suffix;
      if (deck === 'modiano') {
        if (card.suit === 'tarok') suffix = `tarock-${card.rank === 22 ? 'skus' : card.rank}`;
        else suffix = `tarock-${{ clubs: 'kreuz', spades: 'pik', hearts: 'herz', diamonds: 'karo' }[card.suit]}-${{ 5: 'bube', 6: 'cavall', 7: 'dame', 8: 'koenig' }[card.rank]}`;
      } else {
        const catalogue = { moser: 'd02101', cego: 'd02056', neumayer: 'd02911' }[deck];
        const identity = card.suit === 'tarok' ? card.rank === 22 ? 'j01' : String(card.rank).padStart(2, '0')
          : `${{ clubs: 'c', spades: 's', hearts: 'h', diamonds: 'd' }[card.suit]}${{ 5: 'J', 6: 'C', 7: 'Q', 8: 'K' }[card.rank]}`;
        suffix = `${catalogue}${identity}`;
      }
      assert.ok(sourcePath.endsWith(`${suffix}.jpg`), `${deck}/${card.id}: source must be ${suffix}`);
    }
  }
});

test('reconstructed Cego and Czech pips embed their documented symbol and exact count without remote resources', () => {
  for (const deck of ['cego', 'neumayer']) {
    const reconstructed = manifest(deck).cards.filter(card => card.generated);
    assert.equal(reconstructed.length, deck === 'cego' ? 10 : 16);
    for (const card of reconstructed) {
      const svg = asset(deck, card.file).toString('utf8');
      const canonicalCard = canonical.find(entry => entry.id === card.id);
      const expected = physicalPips(canonicalCard);
      assert.match(svg, new RegExp(`data-card-id="${card.id}"`));
      assert.match(svg, new RegExp(`data-pips="${expected}"`));
      assert.match(svg, /<rect\b[^>]*fill="#fff"/);
      assert.doesNotMatch(svg, /<(?:script|foreignObject)\b|\bon\w+=|url\s*\(/i);
      const uses = [...svg.matchAll(/<use\b[^>]*>/g)].map(match => match[0]);
      assert.equal(uses.length, expected, `${deck}/${card.id}: visible pip instances`);
      assert.equal(new Set(uses.map(use => use.match(/transform="([^"]+)"/)?.[1])).size, expected, `${deck}/${card.id}: pips must not overlap exactly`);
      for (const use of uses) {
        assert.match(use, /href="#pip"/);
        assert.match(use, new RegExp(`data-pip="${canonicalCard.suit}"`));
      }
      const links = [...svg.matchAll(/(?:href|xlink:href)="([^"]+)"/g)].map(match => match[1]);
      assert.ok(links.every(link => link === '#pip' || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(link)));
      const embedded = links.filter(link => link.startsWith('data:'));
      assert.equal(embedded.length, 1);
      const symbol = Buffer.from(embedded[0].split(',')[1], 'base64');
      assert.deepEqual(symbol, asset(deck, card.symbolFile), `${deck}/${card.id}: embedded symbol must match the documented extraction`);
      assert.equal(symbol.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(symbol.readUInt32BE(16) > 10 && symbol.readUInt32BE(20) > 10);
    }
  }
});

test('Moser keeps actual patterned pip scans and their lower-resolution PDF provenance', () => {
  const m = manifest('moser');
  assert.ok(m.cards.every(card => !card.generated && card.file.endsWith('.jpg')));
  const pdfCards = m.cards.filter(card => card.sourceObject);
  assert.equal(pdfCards.length, 9);
  const expected = { 'hearts-3': 52, 'hearts-2': 53, 'hearts-1': 42, 'clubs-1': 47, 'clubs-3': 49,
    'diamonds-3': 56, 'diamonds-1': 58, 'spades-2': 34, 'spades-3': 35 };
  assert.deepEqual(Object.fromEntries(pdfCards.map(card => [card.id, card.sourceObject])), expected);
  for (const card of pdfCards) {
    assert.equal(card.sourcePage, 3);
    assert.equal(card.originalWidth, 125, 'Upsampling must not claim a higher-resolution source');
    assert.match(card.quality, /lower resolution/);
    assert.equal(card.sourcePdfSha256, 'e636500050761fa8eeded69538f3fdf7ec9a9e9d6164a9c08a3e94305187846e');
    assert.match(card.correction.pdfColorManagement, /Ghostscript/);
    assert.equal(card.correction.pdfImageRect.length, 4);
  }
});
