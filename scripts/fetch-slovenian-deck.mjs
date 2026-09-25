import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDeck } from '../shared/cards.mjs';

// The publisher's gallery contains the 22 trumps and 16 court cards. Keep
// these original JPEGs unchanged; the 16 pip cards are made separately.
const destination = new URL('../public/cards/slovenian/', import.meta.url);
const website = 'https://slovenski-tarok.si/';
const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
const suits = { clubs: 'kr', spades: 'pi', hearts: 'sr', diamonds: 'ka' };
const courts = { 5: 'fa', 6: 'ko', 7: 'da', 8: 'kr' };

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Expected JPEG signature.');
  // SOF markers carry dimensions without needing an image-library dependency.
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

const sourceCards = createDeck().filter(card => card.suit === 'tarok' || card.rank >= 5);
assert.equal(sourceCards.length, 38);
const sources = sourceCards.map(card => {
  const filename = card.suit === 'tarok'
    ? `${card.rank === 22 ? 'skis' : romans[card.rank - 1]}.jpg`
    : `${suits[card.suit]}_${courts[card.rank]}.jpg`;
  return {
    id: card.id,
    file: `${card.id}.jpg`,
    title: card.name,
    source: new URL(`img/taroki/${filename}`, website).href,
    treatment: 'Original JPEG, downloaded unchanged',
  };
});
assert.equal(new Set(sources.map(card => card.source)).size, 38);

const galleryResponse = await fetch(website, { signal: AbortSignal.timeout(20_000) });
assert.ok(galleryResponse.ok, `Gallery request failed: ${galleryResponse.status}`);
const gallery = await galleryResponse.text();
for (const source of sources) {
  assert.ok(gallery.includes(new URL(source.source).pathname), `Source is missing from the publisher's gallery: ${source.id}`);
}

await mkdir(destination, { recursive: true });
// Retain separately generated pip-card metadata when refreshing source faces.
let generatedCards = [];
try {
  const previous = JSON.parse(await readFile(new URL('sources.json', destination), 'utf8'));
  generatedCards = previous.cards?.filter(card => card.generated) ?? [];
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

for (const source of sources) {
  const response = await fetch(source.source, { signal: AbortSignal.timeout(20_000) });
  assert.ok(response.ok, `${source.id}: download failed (${response.status})`);
  assert.match(response.headers.get('content-type') ?? '', /^image\/jpeg(?:;|$)/i);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 1_000, `Suspiciously small image: ${source.id}`);
  Object.assign(source, jpegDimensions(bytes), {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  await writeFile(new URL(source.file, destination), bytes);
  console.log(`${source.id}: ${source.width}×${source.height}, ${bytes.length} bytes`);
}

await writeFile(new URL('sources.json', destination), JSON.stringify({
  deck: 'Slovenski tarok — Piatnik',
  artist: 'Matjaž Schmidt',
  concept: 'Janez Bogataj',
  commissionedBy: 'Eurotrade Commerce d.o.o., Ljubljana',
  printer: 'Piatnik, Vienna',
  artworkStarted: 1995,
  source: website,
  attributionSource: new URL('zgodovina', website).href,
  rights: 'The source does not state a reuse licence. Original illustrations and concept remain credited to their respective rights holders.',
  retrieved: new Date().toISOString().slice(0, 10),
  sourceFaces: 38,
  note: 'The gallery supplies 22 trumps and 16 court cards at 200×358 pixels. The 16 pip cards are reconstructed separately using suit symbols from these court cards.',
  cards: [...sources, ...generatedCards],
}, null, 2) + '\n');
console.log('Imported all 38 source faces. The separate pip-card generator completes the 54-card deck.');
