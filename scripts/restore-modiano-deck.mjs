import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Repeat the conventional scan cleanup used for Smrekar: retain the original
// drawing, correct photographed frames and paper, and fit inside white margins.
const originals = new URL('../artifacts/modiano-deck/originals/', import.meta.url);
const destination = new URL('../public/cards/deck/', import.meta.url);
const source = JSON.parse(await readFile(new URL('sources.json', originals), 'utf8'));
const selected = process.argv.slice(2);
const entries = source.cards.filter(card => card.id !== 'back' && (!selected.length || selected.includes(card.id)));
assert.ok(entries.length && selected.every(id => entries.some(card => card.id === id)), 'Unknown source card ID.');
const previous = JSON.parse(await readFile(new URL('sources.json', destination), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const settings = { width: 504, height: 904, margin: 14, blackPoint: 9, jpegQuality: .92 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
  const page = await browser.newPage();
  for (const entry of entries) {
    const bytes = await readFile(new URL(entry.file, originals));
    assert.equal(digest(bytes), entry.sha256, `${entry.id}: source changed`);
    const result = await page.evaluate(async ({ src, entry, settings }) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const sw = image.naturalWidth, sh = image.naturalHeight;
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = sw; sourceCanvas.height = sh;
      const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, sw, sh).data;
      const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
      const at = (x, y, c) => pixels[(Math.round(y) * sw + Math.round(x)) * 4 + c];
      const rgbAt = (x, y) => [0, 1, 2].map(c => at(clamp(x, 0, sw - 1), clamp(y, 0, sh - 1), c));
      const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const pip = entry.kind === 'pip';
      function frameLine(side) {
        const vertical = side === 'left' || side === 'right';
        const near = side === 'left' || side === 'top';
        const length = vertical ? sh : sw, breadth = vertical ? sw : sh;
        const samples = [];
        for (let t = .17; t <= .83; t += .008) {
          const along = Math.round(length * t);
          for (let q = Math.round(breadth * .014); q < breadth * .115; q++) {
            const across = near ? q : breadth - 1 - q;
            const rgb = vertical ? rgbAt(across, along) : rgbAt(along, across);
            // The thin printed outline is neutral grey, unlike colored ink.
            if (Math.max(...rgb) < 165 && Math.max(...rgb) - Math.min(...rgb) < 42) {
              samples.push([along, across]); break;
            }
          }
        }
        if (samples.length < 40) throw new Error(`${entry.id}: no reliable ${side} frame`);
        let a = 0, b = median(samples.map(p => p[1]));
        for (let pass = 0; pass < 4; pass++) {
          const kept = samples.filter(([x, y]) => Math.abs(y - a * x - b) < breadth * (pass ? .008 : .025));
          if (kept.length < 35) throw new Error(`${entry.id}: ambiguous ${side} frame`);
          const mx = kept.reduce((n, p) => n + p[0], 0) / kept.length;
          const my = kept.reduce((n, p) => n + p[1], 0) / kept.length;
          a = kept.reduce((n, [x, y]) => n + (x - mx) * (y - my), 0)
            / kept.reduce((n, [x]) => n + (x - mx) ** 2, 0);
          b = my - a * mx;
        }
        return [a, b];
      }
      const intersection = ([a, b], [c, d]) => {
        const x = (a * d + b) / (1 - a * c);
        return [x, c * x + d];
      };
      const edges = pip ? null : ['left', 'right', 'top', 'bottom'].map(frameLine);
      const quad = pip ? [[sw * .025, sh * .015], [sw * .975, sh * .015], [sw * .975, sh * .985], [sw * .025, sh * .985]]
        : [intersection(edges[0], edges[2]), intersection(edges[1], edges[2]), intersection(edges[1], edges[3]), intersection(edges[0], edges[3])];
      function homography(quad) {
        const rows = [];
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
          const [x, y] = quad[i];
          rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x]);
          rows.push([0, 0, 0, u, v, 1, -y * u, -y * v, y]);
        });
        for (let col = 0; col < 8; col++) {
          let pivot = col;
          for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
          [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
          const divisor = rows[col][col];
          if (Math.abs(divisor) < 1e-9) throw new Error('Degenerate frame');
          rows[col] = rows[col].map(x => x / divisor);
          for (let row = 0; row < 8; row++) {
            if (row === col) continue;
            const factor = rows[row][col];
            rows[row] = rows[row].map((x, i) => x - rows[col][i] * factor);
          }
        }
        const m = rows.map(row => row[8]);
        return (u, v) => {
          const d = m[6] * u + m[7] * v + 1;
          return [(m[0] * u + m[1] * v + m[2]) / d, (m[3] * u + m[4] * v + m[5]) / d];
        };
      }
      const project = homography(quad);
      const references = [];
      for (let t = .15; t < .85; t += .01) {
        const positions = pip ? [[.03, t], [.97, t], [t, .025], [t, .975]]
          : [[-.022, t], [1.022, t], [t, -.012], [t, 1.012]];
        for (const [u, v] of positions) {
          const [x, y] = project(u, v), rgb = rgbAt(x, y);
          if (Math.min(...rgb) > 170) references.push(rgb);
        }
      }
      if (references.length < 100) throw new Error(`${entry.id}: insufficient paper reference`);
      const paper = [0, 1, 2].map(c => median(references.map(rgb => rgb[c])));
      const { width, height, margin, blackPoint } = settings;
      const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      const originalWidth = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
      const originalHeight = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
      const scale = Math.min((width - 2 * margin) / originalWidth, (height - 2 * margin) / originalHeight);
      const iw = Math.round(originalWidth * scale), ih = Math.round(originalHeight * scale);
      const mx = Math.floor((width - iw) / 2), my = Math.floor((height - ih) / 2);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const outContext = canvas.getContext('2d');
      const out = outContext.createImageData(width, height); out.data.fill(255);
      function sample(x, y) {
        if (x < 0 || x >= sw - 1 || y < 0 || y >= sh - 1) return [255, 255, 255];
        const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
        return [0, 1, 2].map(c => at(ix, iy, c) * (1 - dx) * (1 - dy) + at(ix + 1, iy, c) * dx * (1 - dy)
          + at(ix, iy + 1, c) * (1 - dx) * dy + at(ix + 1, iy + 1, c) * dx * dy);
      }
      for (let y = my; y < my + ih; y++) for (let x = mx; x < mx + iw; x++) {
        // Breathing room preserves the complete rounded printed outline.
        const u = ((x - mx) / (iw - 1) - .5) * (pip ? 1 : 1.012) + .5;
        const v = ((y - my) / (ih - 1) - .5) * (pip ? 1 : 1.006) + .5;
        const [sx, sy] = project(u, v);
        let rgb = sample(sx, sy).map((value, c) => clamp((value - blackPoint) / (paper[c] - blackPoint)));
        if (Math.min(...rgb) > (pip ? .83 : .94) && Math.max(...rgb) - Math.min(...rgb) < (pip ? .14 : .06)) rgb = [1, 1, 1];
        const offset = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) out.data[offset + c] = Math.round(255 * rgb[c]);
      }
      let dustComponentsRemoved = 0;
      if (pip) {
        // Remove only isolated specks smaller than printed glyphs. Large
        // connected pip shapes and every part of the maker's mark survive.
        const seen = new Uint8Array(width * height);
        const ink = i => Math.min(out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2]) < 240;
        for (let start = 0; start < seen.length; start++) {
          if (seen[start] || !ink(start)) continue;
          const component = [start]; seen[start] = 1;
          for (let n = 0; n < component.length; n++) {
            const at = component[n], x = at % width, y = Math.floor(at / width);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
              const next = (y + dy) * width + x + dx;
              if (!seen[next] && ink(next)) { seen[next] = 1; component.push(next); }
            }
          }
          const hasPrintedInk = component.some(at => {
            const [r, g, b] = out.data.subarray(at * 4, at * 4 + 3);
            return Math.max(r, g, b) < 102 || (r > 128 && r - g > 128 && r - b > 128);
          });
          if (component.length < 12 || !hasPrintedInk) {
            dustComponentsRemoved++;
            for (const at of component) for (let c = 0; c < 3; c++) out.data[at * 4 + c] = 255;
          }
        }
      }
      outContext.putImageData(out, 0, 0);
      return { data: canvas.toDataURL('image/jpeg', settings.jpegQuality), quad, paper, imageBounds: [mx, my, iw, ih], dustComponentsRemoved };
    }, { src: `data:image/jpeg;base64,${bytes.toString('base64')}`, entry, settings });
    const rendered = Buffer.from(result.data.split(',')[1], 'base64');
    await writeFile(new URL(entry.file, destination), rendered);
    const corrected = { ...entry, width: settings.width, height: settings.height, bytes: rendered.length, sha256: digest(rendered), adjusted: true,
      sourceScan: { width: entry.width, height: entry.height, bytes: entry.bytes, sha256: entry.sha256 },
      correction: { script: 'scripts/restore-modiano-deck.mjs', ...settings, quad: result.quad, paperWhite: result.paper, imageBounds: result.imageBounds, dustComponentsRemoved: result.dustComponentsRemoved, background: '#ffffff' },
      treatment: 'Conventional frame rectification and paper-reference white balance from full-resolution source photographs; original artwork and physical pip counts retained inside white margins.',
    };
    previous.cards = previous.cards.map(card => card.id === entry.id ? corrected : card);
    console.log(`${entry.id}: ${settings.width}×${settings.height}; paper ${result.paper.join(',')}`);
  }
  const retainedBack = previous.cards.find(card => card.id === 'back');
  if (retainedBack) retainedBack.retrieved ??= previous.retrieved;
  previous.retrieved = source.retrieved;
  previous.artworkVersion = 2;
  previous.restored = new Date().toISOString().slice(0, 10);
  previous.note = 'All 54 faces are conventionally restored from full-resolution photographs, with white margins and clean pip backgrounds. The unused original back is retained separately without alteration.';
  await writeFile(new URL('sources.json', destination), `${JSON.stringify(previous, null, 2)}\n`);
} finally { await browser.close(); }
