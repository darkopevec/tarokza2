import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Conventional, deterministic photo corrections. Every output pixel comes
// from a source scan or the white canvas; no illustration is regenerated.
const originals = new URL('../artifacts/smrekar-deck/originals/', import.meta.url);
const destination = new URL('../public/cards/smrekar/', import.meta.url);
const source = JSON.parse(await readFile(new URL('sources.json', originals), 'utf8'));
const settings = JSON.parse(await readFile(new URL('smrekar-restoration.json', import.meta.url), 'utf8'));
const selected = process.argv.slice(2);
const entries = [...source.cards, source.back].filter(card => !selected.length || selected.includes(card.id));
assert.ok(entries.length, 'No matching source cards.');
assert.ok(selected.every(id => entries.some(card => card.id === id)), 'Unknown source card ID.');
const previous = JSON.parse(await readFile(new URL('sources.json', destination), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
await mkdir(destination, { recursive: true });
try {
  const page = await browser.newPage();
  for (const entry of entries) {
    const bytes = await readFile(new URL(entry.file, originals));
    assert.equal(digest(bytes), entry.sha256, `${entry.id}: original scan changed`);
    if (settings.cards[entry.id]) assert.deepEqual(settings.cards[entry.id].size, [entry.width, entry.height], `${entry.id}: remeasure the frame for the new source dimensions`);
    const result = await page.evaluate(async ({ src, entry, settings }) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const sw = sourceCanvas.width, sh = sourceCanvas.height;
      const pixels = context.getImageData(0, 0, sw, sh).data;
      const { width, height, margin, curve } = settings;
      const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
      function sample(x, y) {
        if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) return [255, 255, 255];
        const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
        const at = (x, y, channel) => pixels[(y * sw + x) * 4 + channel];
        return [0, 1, 2].map(channel =>
          at(ix, iy, channel) * (1 - dx) * (1 - dy) + at(ix + 1, iy, channel) * dx * (1 - dy)
          + at(ix, iy + 1, channel) * (1 - dx) * dy + at(ix + 1, iy + 1, channel) * dx * dy);
      }
      // Solve the unit-square to photographed-frame homography.
      function homography(quad) {
        const rows = [];
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], index) => {
          const [x, y] = quad[index];
          rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x]);
          rows.push([0, 0, 0, u, v, 1, -y * u, -y * v, y]);
        });
        for (let column = 0; column < 8; column++) {
          let pivot = column;
          for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
          [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
          const divisor = rows[column][column];
          if (Math.abs(divisor) < 1e-9) throw new Error('Degenerate card quadrilateral');
          rows[column] = rows[column].map(value => value / divisor);
          for (let row = 0; row < 8; row++) {
            if (row === column) continue;
            const factor = rows[row][column];
            rows[row] = rows[row].map((value, index) => value - rows[column][index] * factor);
          }
        }
        const m = rows.map(row => row[8]);
        return (u, v) => {
          const d = m[6] * u + m[7] * v + 1;
          return [(m[0] * u + m[1] * v + m[2]) / d, (m[3] * u + m[4] * v + m[5]) / d];
        };
      }
      const profile = settings.cards[entry.id];
      const quad = profile?.quad ?? [[0, 0], [sw - 1, 0], [sw - 1, sh - 1], [0, sh - 1]];
      const project = homography(quad);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const outContext = canvas.getContext('2d');
      const output = outContext.createImageData(width, height);
      output.data.fill(255);
      const pip = entry.kind === 'pip';
      const back = entry.kind === 'back';
      let paper = [255, 255, 255];
      if (!pip) {
        const samples = [];
        for (let i = 10; i < 90; i++) {
          const t = i / 100;
          const positions = back ? [[.12, t], [.88, t], [t, .025], [t, .97]]
            : [[-.022, t], [1.022, t], [t, -.012], [t, 1.012]];
          for (const [u, v] of positions) {
            const [x, y] = project(u, v);
            if (x < 1 || y < 1 || x > sw - 2 || y > sh - 2) continue;
            const rgb = sample(x, y);
            if (Math.min(...rgb) > 70 && Math.max(...rgb) < 247) samples.push(rgb);
          }
        }
        if (!samples.length) throw new Error(`${entry.id}: no paper reference`);
        // Upper-middle quantile of the photographed PAPER, excluding the
        // outside backdrop and frame ink. Per-channel gains remove its cast.
        paper = [0, 1, 2].map(channel => {
          const values = samples.map(rgb => rgb[channel]).sort((a, b) => a - b);
          return Math.round(values[Math.floor(values.length * .65)]);
        });
      }
      function tone(value) {
        value = clamp(value);
        let i = 1;
        while (i < curve.length - 1 && value > curve[i][0]) i++;
        const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
        return y0 + (y1 - y0) * (value - x0) / (x1 - x0);
      }
      const innerWidth = width - margin * 2, innerHeight = height - margin * 2;
      for (let y = margin; y < height - margin; y++) {
        for (let x = margin; x < width - margin; x++) {
          // Include two source pixels of breathing space beyond the printed
          // outline, so its original outer stroke is never trimmed off.
          const u = ((x - margin) / (innerWidth - 1) - .5) * (pip || back ? 1 : 1.012) + .5;
          const v = ((y - margin) / (innerHeight - 1) - .5) * (pip || back ? 1 : 1.006) + .5;
          const [sx, sy] = project(u, v);
          const original = sample(sx, sy);
          let rgb;
          if (pip) {
            // Only the existing ink is retained; the photographed blank
            // stock and tabletop are replaced with an exactly white field.
            if (sx < 18 || sx > sw - 18 || sy < 18 || sy > sh - 18) continue;
            if (entry.id.startsWith('diamonds')) {
              const chroma = original[0] - (original[1] + original[2]) / 2;
              const alpha = clamp((chroma - 18) / 32);
              rgb = original.map((value, channel) => 255 * (1 - alpha)
                + clamp(value * (channel === 0 ? 1.2 : 1), 0, 255) * alpha);
            } else {
              rgb = original.map(value => 255 * tone((value - 12) / 104));
            }
          } else {
            rgb = original.map((value, channel) => 255 * tone((value - settings.blackPoint) / (paper[channel] - settings.blackPoint)));
          }
          const offset = (y * width + x) * 4;
          for (let channel = 0; channel < 3; channel++) output.data[offset + channel] = Math.round(rgb[channel]);
        }
      }
      outContext.putImageData(output, 0, 0);
      return { data: canvas.toDataURL('image/jpeg', settings.jpegQuality), paper, quad };
    }, { src: `data:image/jpeg;base64,${bytes.toString('base64')}`, entry, settings });
    const rendered = Buffer.from(result.data.split(',')[1], 'base64');
    await writeFile(new URL(entry.file, destination), rendered);
    const corrected = {
      ...entry,
      width: settings.width, height: settings.height, bytes: rendered.length, sha256: digest(rendered),
      adjusted: true,
      sourceScan: { width: entry.width, height: entry.height, bytes: entry.bytes, sha256: entry.sha256 },
      correction: {
        script: 'scripts/restore-smrekar-deck.mjs', profile: 'scripts/smrekar-restoration.json',
        quad: result.quad, paperWhite: result.paper, curve: settings.curve,
        blackPoint: settings.blackPoint, background: '#ffffff',
      },
      treatment: entry.kind === 'pip'
        ? 'Conventional correction of original pip scan; original marks and positions preserved on a uniform white background.'
        : 'Conventional perspective correction, paper-reference white balance and tonal curves; original artwork preserved within white margins.',
    };
    if (entry.id === 'back') previous.back = corrected;
    else previous.cards = previous.cards.map(card => card.id === entry.id ? corrected : card);
    console.log(`${entry.id}: ${settings.width}×${settings.height}; paper white ${result.paper.join(',')}`);
  }
  previous.artworkVersion = 2;
  previous.note = '41 source faces and the original back have conventional color and perspective corrections. All paper margins and pip backgrounds are white. The other 13 pip cards use the existing extracted suit symbols on white SVG canvases.';
  await writeFile(new URL('sources.json', destination), `${JSON.stringify(previous, null, 2)}\n`);
} finally {
  await browser.close();
}
