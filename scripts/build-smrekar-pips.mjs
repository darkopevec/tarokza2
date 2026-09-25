import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createDeck } from '../shared/cards.mjs';

// The 41 available faces are immutable source scans. Only the 13 missing
// low suit cards are reconstructed, using this deck's own four suit marks.
const directory = new URL('../public/cards/smrekar/', import.meta.url);
const manifestPath = new URL('sources.json', directory);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const atlas = await readFile(new URL('suit-symbols.png', directory));
const sourceIds = { hearts: 'hearts-8', diamonds: 'diamonds-4', clubs: 'clubs-1', spades: 'spades-1' };
const originals = manifest.cards.filter(card => !card.generated);
const sources = Object.fromEntries(Object.entries(sourceIds).map(([suit, id]) => [suit, originals.find(card => card.id === id)]));
const paperReferences = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([suit, card]) => [suit,
  `data:image/jpeg;base64,${(await readFile(new URL(card.file, directory))).toString('base64')}`,
])));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
let symbols;
try {
  const page = await browser.newPage();
  symbols = await page.evaluate(async ({ src, references }) => {
    async function canvasFor(src) {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas;
    }
    const canvas = await canvasFor(src);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    if (pixels[3] !== 0) throw new Error('The suit atlas must have a transparent background.');
    const result = {};
    for (const [suit, column, row] of [['hearts', 0, 0], ['diamonds', 1, 0], ['clubs', 0, 1], ['spades', 1, 1]]) {
      const left = Math.floor(column * canvas.width / 2), right = Math.floor((column + 1) * canvas.width / 2);
      const top = Math.floor(row * canvas.height / 2), bottom = Math.floor((row + 1) * canvas.height / 2);
      let x0 = right, y0 = bottom, x1 = left, y1 = top;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] < 8) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      if (x1 <= x0 || y1 <= y0) throw new Error(`Missing ${suit} symbol.`);
      const width = x1 - x0 + 1, height = y1 - y0 + 1;
      const output = document.createElement('canvas');
      const scale = 160 / Math.max(width, height);
      output.width = Math.round(width * scale);
      output.height = Math.round(height * scale);
      const target = output.getContext('2d');
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = 'high';
      target.drawImage(canvas, x0, y0, width, height, 0, 0, output.width, output.height);
      // Sample empty paper patches so reconstructed cards blend with the
      // surviving suit scans, whose photographic paper tones vary by suit.
      const paper = await canvasFor(references[suit]);
      const context = paper.getContext('2d');
      const patches = suit === 'hearts' ? [[.9, .12], [.1, .84], [.1, .9]] : [[.5, .12], [.5, .4], [.5, .85]];
      const colors = patches.map(([x, y]) => {
        const data = context.getImageData(Math.floor(paper.width * x) - 3, Math.floor(paper.height * y) - 3, 6, 6).data;
        return [0, 1, 2].map(channel => Math.round(Array.from({ length: 36 }, (_, i) => data[i * 4 + channel]).reduce((a, b) => a + b) / 36));
      });
      result[suit] = { data: output.toDataURL('image/png'), width: output.width, height: output.height, bounds: [x0, y0, width, height], colors };
    }
    return result;
  }, { src: `data:image/png;base64,${atlas.toString('base64')}`, references: paperReferences });
} finally {
  await browser.close();
}

const pair = y => [[50, y], [150, y]];
const layouts = {
  1: [[100, 179]],
  2: [[100, 46], [100, 312]],
  3: [[100, 46], [100, 179], [100, 312]],
  4: [...pair(46), ...pair(312)],
  8: [...pair(46), ...pair(135), ...pair(223), ...pair(312)],
  9: [...pair(46), ...pair(135), ...pair(223), ...pair(312), [100, 179]],
  10: [...pair(46), ...pair(135), ...pair(223), ...pair(312), [100, 91], [100, 267]],
};
const existingIds = new Set(originals.map(card => card.id));
const pipCards = createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4 && !existingIds.has(card.id));
assert.equal(pipCards.length, 13);
const generated = [];
for (const card of pipCards) {
  const count = Number(card.label);
  const positions = layouts[count];
  assert.equal(positions.length, count);
  const symbol = symbols[card.suit];
  const scale = 47 / Math.max(symbol.width, symbol.height);
  const width = Number((symbol.width * scale).toFixed(3));
  const height = Number((symbol.height * scale).toFixed(3));
  const uses = positions.map(([x, y]) => `  <use href="#pip" data-pip="${card.suit}" transform="translate(${x} ${y})${y > 179 ? ' rotate(180)' : ''}"/>`).join('\n');
  const stops = symbol.colors.map((rgb, index) => `<stop offset="${index * 50}%" stop-color="rgb(${rgb.join(',')})"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="358" viewBox="0 0 200 358" role="img" aria-labelledby="name" data-card-id="${card.id}" data-pips="${count}">
  <title id="name">${card.name}</title>
  <defs>
    <linearGradient id="paper" x2="0" y2="1">${stops}</linearGradient>
    <g id="pip"><image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" href="${symbol.data}"/></g>
  </defs>
  <rect width="200" height="358" fill="url(#paper)"/>
${uses}
</svg>
`;
  const bytes = Buffer.from(svg);
  await writeFile(new URL(`${card.id}.svg`, directory), bytes);
  generated.push({
    id: card.id, file: `${card.id}.svg`, title: card.name, kind: 'pip', generated: true,
    pipCount: count, width: 200, height: 358,
    source: sources[card.suit].source, description: sources[card.suit].description,
    sourceCard: sources[card.suit].file, symbolAtlas: 'suit-symbols.png',
    symbolAtlasSha256: createHash('sha256').update(atlas).digest('hex'),
    atlasBounds: symbol.bounds, paperColors: symbol.colors,
    treatment: 'AI-assisted extraction of an original Smrekar suit mark; self-contained SVG with exact pip count and sampled paper colors. Reconstructed card, not an original scan.',
    generator: 'scripts/build-smrekar-pips.mjs', prompt: 'docs/smrekar-pips-prompt.md',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(`${card.id}: ${count} pips, ${bytes.length} bytes`);
}
manifest.cards = [...originals, ...generated];
assert.deepEqual(manifest.cards.map(card => card.id).sort(), createDeck().map(card => card.id).sort());
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Completed 54 faces: 41 source scans and 13 reconstructed pip cards, plus the matching back.');
