import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createDeck } from '../shared/cards.mjs';

// Compose exact pip counts from the four extracted suit symbols. The source
// illustrations stay untouched; the resulting SVGs are self-contained images.
const directory = new URL('../public/cards/slovenian/', import.meta.url);
const atlas = await readFile(new URL('suit-symbols.png', directory));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
let symbols;
try {
  const page = await browser.newPage();
  symbols = await page.evaluate(async src => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    if (pixels[3] !== 0) throw new Error('The suit atlas must have a transparent background.');
    const result = {};
    for (const [suit, column, row] of [['hearts', 0, 0], ['diamonds', 1, 0], ['clubs', 0, 1], ['spades', 1, 1]]) {
      const left = Math.floor(column * canvas.width / 2);
      const top = Math.floor(row * canvas.height / 2);
      const right = Math.floor((column + 1) * canvas.width / 2);
      const bottom = Math.floor((row + 1) * canvas.height / 2);
      let x0 = right, y0 = bottom, x1 = left, y1 = top;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] < 8) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      if (x1 <= x0 || y1 <= y0) throw new Error(`Missing ${suit} symbol.`);
      // Trim transparent sprite padding and downsample for compact embedded
      // data, retaining more than 3x the normal displayed pip resolution.
      const width = x1 - x0 + 1, height = y1 - y0 + 1;
      const output = document.createElement('canvas');
      const scale = 160 / Math.max(width, height);
      output.width = Math.round(width * scale);
      output.height = Math.round(height * scale);
      const target = output.getContext('2d');
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = 'high';
      target.drawImage(canvas, x0, y0, width, height, 0, 0, output.width, output.height);
      result[suit] = { data: output.toDataURL('image/png'), width: output.width, height: output.height, bounds: [x0, y0, width, height] };
    }
    return result;
  }, `data:image/png;base64,${atlas.toString('base64')}`);
} finally {
  await browser.close();
}

const pair = y => [[50, y], [150, y]];
const layouts = {
  1: [[100, 179]],
  2: [[100, 50], [100, 308]],
  3: [[100, 50], [100, 179], [100, 308]],
  4: [...pair(50), ...pair(308)],
  7: [...pair(50), ...pair(179), ...pair(308), [100, 114]],
  8: [...pair(50), ...pair(179), ...pair(308), [100, 114], [100, 244]],
  9: [...pair(50), ...pair(136), ...pair(222), ...pair(308), [100, 179]],
  10: [...pair(50), ...pair(136), ...pair(222), ...pair(308), [100, 93], [100, 265]],
};
const pipCards = createDeck().filter(card => card.suit !== 'tarok' && card.rank < 5);
assert.equal(pipCards.length, 16);
const generated = [];
for (const card of pipCards) {
  const count = Number(card.label);
  const positions = layouts[count];
  assert.equal(positions.length, count);
  const symbol = symbols[card.suit];
  const scale = (count === 1 ? 60 : 50) / Math.max(symbol.width, symbol.height);
  const width = Number((symbol.width * scale).toFixed(3));
  const height = Number((symbol.height * scale).toFixed(3));
  const uses = positions.map(([x, y]) => `  <use href="#pip" data-pip="${card.suit}" transform="translate(${x} ${y})${y > 179 ? ' rotate(180)' : ''}"/>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="358" viewBox="0 0 200 358" role="img" aria-labelledby="name" data-card-id="${card.id}" data-pips="${count}">
  <title id="name">${card.name}</title>
  <rect width="200" height="358" fill="#fff"/>
  <rect x="16" y="15" width="168" height="328" rx="8" fill="none" stroke="#d8cf61" stroke-width="0.65"/>
  <defs><g id="pip"><image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" href="${symbol.data}"/></g></defs>
${uses}
</svg>
`;
  const bytes = Buffer.from(svg);
  await writeFile(new URL(`${card.id}.svg`, directory), bytes);
  generated.push({
    id: card.id, file: `${card.id}.svg`, title: card.name, generated: true,
    pipCount: count, width: 200, height: 358,
    source: `https://slovenski-tarok.si/img/taroki/${{ hearts: 'sr', diamonds: 'ka', clubs: 'kr', spades: 'pi' }[card.suit]}_kr.jpg`,
    sourceCard: `${card.suit}-8.jpg`, symbolAtlas: 'suit-symbols.png',
    symbolAtlasSha256: createHash('sha256').update(atlas).digest('hex'),
    atlasBounds: symbol.bounds,
    treatment: 'AI-assisted extraction of the king card suit mark; transparent sprite composed into an exact pip-count SVG. Reconstructed pip card, not an original scan.',
    generator: 'scripts/build-slovenian-pips.mjs', prompt: 'docs/slovenian-pips-prompt.md',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(`${card.id}: ${count} pips, ${bytes.length} bytes`);
}
const manifestPath = new URL('sources.json', directory);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.cards = [...manifest.cards.filter(card => !card.generated), ...generated];
assert.deepEqual(manifest.cards.map(card => card.id).sort(), createDeck().map(card => card.id).sort());
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Completed 54 faces: 38 original illustrations and 16 reconstructed pip cards.');
