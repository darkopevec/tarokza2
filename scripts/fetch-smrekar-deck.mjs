import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDeck } from '../shared/cards.mjs';

// Retain unchanged historical scans outside the served artwork. Commons provides
// 41 faces and a back; restore-smrekar-deck.mjs corrects those source scans before
// build-smrekar-pips.mjs reconstructs the 13 missing pip cards.
const destination = new URL('../artifacts/smrekar-deck/originals/', import.meta.url);
const source = 'https://commons.wikimedia.org/wiki/Category:Smrekar%27s_Tarot';
const attributionSource = 'https://smrekar.ng-slo.si/slovanski-tarok/';
const headers = { 'User-Agent': 'Tarokza2DeckImporter/1.0 (https://github.com/darkopevec/tarokza2)' };
const romans = ['I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII'];
const suits = { clubs: 'križ', spades: 'pik', hearts: 'srce', diamonds: 'karo' };
const courts = { 5: 'fant', 6: 'kaval', 7: 'kraljica', 8: 'kralj' };
const survivingPips = new Set(['clubs-1', 'spades-1', 'diamonds-4']);

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Expected JPEG signature.');
  for (let offset = 2; offset + 8 < bytes.length;) {
    assert.equal(bytes[offset], 0xff, 'Invalid JPEG marker.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'Invalid JPEG segment.');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions were not found.');
}

function withoutTracking(value) {
  const url = new URL(value);
  url.search = '';
  return url.href;
}

const cards = createDeck()
  .filter(card => card.suit === 'tarok' || card.rank >= 5 || survivingPips.has(card.id))
  .map(card => ({
    id: card.id,
    file: `${card.id}.jpg`,
    title: card.name,
    kind: card.suit === 'tarok' ? 'trump' : card.rank >= 5 ? 'court' : 'pip',
    ...(survivingPips.has(card.id) ? { pipCount: Number(card.label) } : {}),
    commonsFile: card.suit === 'tarok'
      ? `File:Hinko Smrekar - Slovanski tarok ${romans[card.rank - 1]}.jpg`
      : `File:Smrekarjev tarok - ${suits[card.suit]} ${courts[card.rank] ?? card.label}.jpg`,
  }));
assert.equal(cards.length, 41);
const back = { id: 'back', file: 'back.jpg', title: 'Hrbtna stran', kind: 'back', commonsFile: 'File:Smrekarjev tarok - zadnja stran.jpg' };
const entries = [...cards, back];
assert.equal(new Set(entries.map(card => card.commonsFile)).size, 42);

const api = new URL('https://commons.wikimedia.org/w/api.php');
api.search = new URLSearchParams({
  action: 'query', format: 'json', prop: 'imageinfo',
  iiprop: 'url|size|extmetadata', iiurlwidth: '500',
  titles: entries.map(card => card.commonsFile).join('|'),
});
const response = await fetch(api, { headers, signal: AbortSignal.timeout(30_000) });
assert.ok(response.ok, `Commons metadata request failed (${response.status}).`);
const metadata = await response.json();
assert.ok(!metadata.error, `Commons API failed: ${JSON.stringify(metadata.error)}`);
const pages = new Map(Object.values(metadata.query.pages).map(page => [page.title, page]));
await mkdir(destination, { recursive: true });

// Download the surviving pips and sample court/trump first to support visual review.
const samples = new Set(['hearts-8', 'diamonds-4', 'clubs-1', 'spades-1', 'tarok-21']);
const downloadOrder = [...entries].sort((a, b) => Number(samples.has(b.id)) - Number(samples.has(a.id)));
for (const card of downloadOrder) {
  const info = pages.get(card.commonsFile)?.imageinfo?.[0];
  assert.ok(info?.thumburl && info?.url, `Source image is missing: ${card.commonsFile}`);
  const license = info.extmetadata?.LicenseShortName?.value;
  assert.equal(license, 'Public domain', `Review the changed source licence: ${card.commonsFile}`);
  const categories = (info.extmetadata?.Categories?.value ?? '').split('|');
  const licenseTemplate = categories.find(category => category.startsWith('PD-Art ('));
  assert.ok(licenseTemplate, `Review the source rights statement: ${card.commonsFile}`);
  Object.assign(card, {
    source: withoutTracking(info.thumburl),
    original: withoutTracking(info.url),
    description: info.descriptionurl,
    originalWidth: info.width,
    originalHeight: info.height,
    license,
    licenseTemplate,
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    treatment: 'Wikimedia Commons JPEG thumbnail, downloaded unchanged from the source scan',
  });
  const image = await fetch(card.source, { headers, signal: AbortSignal.timeout(30_000) });
  assert.ok(image.ok, `${card.id}: image request failed (${image.status}).`);
  assert.match(image.headers.get('content-type') ?? '', /^image\/jpeg(?:;|$)/i);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.ok(bytes.length > 1_000, `Suspiciously small image: ${card.id}`);
  Object.assign(card, jpegDimensions(bytes), {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  await writeFile(new URL(card.file, destination), bytes);
  console.log(`${card.id}: ${card.width}×${card.height}, ${card.bytes} bytes`);
}

await writeFile(new URL('sources.json', destination), `${JSON.stringify({
  deck: 'Slovanski tarok — Hinko Smrekar',
  artist: 'Hinko Smrekar',
  artworkDate: '1910–1912',
  source,
  attributionSource,
  rights: 'Wikimedia Commons classifies each source scan as public domain under PD-Art (PD-old-auto-expired). Per-file source and licence records are included below.',
  retrieved: new Date().toISOString().slice(0, 10),
  sourceFaces: 41,
  note: '22 complete trumps, 16 court cards and three pip cards are unchanged Commons JPEG thumbnails retained as restoration inputs. The original card back is included separately. Run the restorer and then the pip-card generator to create the served 54-card deck.',
  back,
  cards,
}, null, 2)}\n`);
console.log('Imported 41 source faces and the card back into artifacts/smrekar-deck/originals/.');
console.log('Run node scripts/restore-smrekar-deck.mjs, then node scripts/build-smrekar-pips.mjs to update the served deck.');
