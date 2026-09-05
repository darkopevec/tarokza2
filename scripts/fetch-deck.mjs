import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDeck } from '../shared/cards.mjs';

// Import the complete, single-source Modiano Tarok Študentski servis Maribor pack.
// Download Commons' existing thumbnails unchanged; do not redraw or crop the cards.
const destination = new URL('../public/cards/deck/', import.meta.url);
const api = new URL('https://commons.wikimedia.org/w/api.php');
const parameters = {
  action: 'query', format: 'json', generator: 'categorymembers',
  gcmtitle: 'Category:Industrie und Glück', gcmtype: 'file', gcmlimit: '200',
  prop: 'imageinfo', iiprop: 'url', iiurlwidth: '330',
};
const pages = {};
let continuation = {};
do {
  api.search = new URLSearchParams({ ...parameters, ...continuation });
  const response = await fetch(api);
  if (!response.ok) throw new Error(`Commons catalogue request failed: ${response.status}`);
  const batch = await response.json();
  assert.ok(batch.query?.pages, 'Commons returned no card catalogue.');
  for (const [id, page] of Object.entries(batch.query.pages)) pages[id] = { ...pages[id], ...page };
  continuation = batch.continue;
} while (continuation);
const suits = { karo: 'diamonds', herz: 'hearts', pik: 'spades', kreuz: 'clubs' };
const courts = { bube: 5, cavall: 6, dame: 7, koenig: 8 };
const sources = [];
for (const page of Object.values(pages)) {
  const match = page.title.match(/^File:SPKW-Q2171-IMG \d+-(.+)\.jpg$/);
  if (!match) continue;
  let id;
  if (match[1] === 'rueckseite') id = 'back';
  else if (match[1] === 'tarock-skus') id = 'tarok-22';
  else if (/^tarock-\d+$/.test(match[1])) id = `tarok-${Number(match[1].split('-')[1])}`;
  else {
    const suited = match[1].match(/^tarock-(karo|herz|pik|kreuz)-(\d+|bube|cavall|dame|koenig)$/);
    if (!suited) continue;
    const [, sourceSuit, sourceRank] = suited;
    const red = ['karo', 'herz'].includes(sourceSuit);
    const rank = courts[sourceRank] ?? (red ? 5 - Number(sourceRank) : Number(sourceRank) - 6);
    id = `${suits[sourceSuit]}-${rank}`;
  }
  const info = page.imageinfo?.[0];
  assert.ok(info?.thumburl, `Missing thumbnail for ${page.title}`);
  sources.push({ id, file: `${id}.jpg`, title: page.title,
    source: info.descriptionurl, thumbnail: info.thumburl.split('?')[0] });
}
const expected = [...createDeck().map(card => card.id), 'back'].sort();
assert.deepEqual(sources.map(source => source.id).sort(), expected, 'Source pack must map exactly to all 54 cards and one back.');
await mkdir(destination, { recursive: true });
// Gentle sequential downloading avoids overwhelming the Commons thumbnail service.
for (const source of sources.sort((a, b) => a.id.localeCompare(b.id))) {
  const image = await fetch(source.thumbnail);
  if (!image.ok) throw new Error(`${source.id}: download failed (${image.status})`);
  assert.match(image.headers.get('content-type') || '', /^image\/jpeg/);
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.ok(bytes.length > 1000, `Suspiciously small image for ${source.id}`);
  await writeFile(new URL(source.file, destination), bytes);
  console.log(`${source.id}: ${bytes.length} bytes`);
}
await writeFile(new URL('sources.json', destination), JSON.stringify({
  deck: 'S. Modiano — Tarok Študentski servis Maribor (1995)',
  photographer: 'Martin Okrslar', source: 'Wikimedia Commons',
  sourceClassification: 'PD-old-100 / Public Domain Mark 1.0, as stated by Commons',
  retrieved: new Date().toISOString().slice(0, 10),
  cards: sources,
}, null, 2) + '\n');
console.log('Imported all 54 card faces and the matching back.');
