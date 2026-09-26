import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { createDeck } from '../shared/cards.mjs';

// Preserve Moser's actual 1906 designs, including the patterned pip cards.
// WWPCM has 45 faces; nine missing pips are embedded original JPEG scans in
// the Berman collection's complete-deck PDF. No artwork is invented.
const originals = new URL('../artifacts/new-decks/moser/originals/', import.meta.url);
const destination = new URL('../public/cards/moser/', import.meta.url);
const wwpcm = 'http://a.trionfi.eu/WWPCM/decks05/d02101/';
const pdfUrl = 'https://static1.squarespace.com/static/5e68e6f8d34bcf00a52fd5a6/t/65b01721fab15431760bad07/1706039073712/MCB%2BDitha%2BMoser%2BTarock.pdf';
const pdfPath = new URL('../artifacts/new-decks/moser/MCB-Ditha-Moser-Tarock.pdf', import.meta.url);
const pdfRenderedPath = new URL('../artifacts/new-decks/moser/berman-suits-rgb.png', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const existingPips = {
  'hearts-4': 'hA', 'diamonds-4': 'dA', 'diamonds-2': 'd3',
  'spades-1': 's7', 'spades-4': 's10', 'clubs-2': 'c8', 'clubs-4': 'c10',
};
// PDF page 3: hearts, clubs, diamonds, spades; first four columns are pips.
const pdfObjects = {
  'hearts-3': 52, 'hearts-2': 53, 'hearts-1': 42,
  'clubs-1': 47, 'clubs-3': 49,
  'diamonds-3': 56, 'diamonds-1': 58,
  'spades-2': 34, 'spades-3': 35,
};
const pdfRects = {
  'hearts-3': [104.625, 60.2052, 59.625, 123.6521],
  'hearts-2': [173.25, 59.9754, 59.625, 124.1118],
  'hearts-1': [241.875, 60.2852, 59.625, 123.4921],
  'clubs-1': [36, 226.583, 59.625, 125.0214],
  'clubs-3': [173.25, 226.7267, 59.625, 124.7341],
  'diamonds-3': [104.625, 393.7589, 59.625, 124.795],
  'diamonds-1': [241.875, 393.8387, 59.625, 124.6351],
  'spades-2': [104.625, 560.6848, 59.625, 125.0679],
  'spades-3': [173.25, 561.3745, 59.625, 123.6885],
};

async function download(url, path) {
  try { return await readFile(path); } catch { /* first import */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes);
  return bytes;
}

await mkdir(originals, { recursive: true });
await mkdir(destination, { recursive: true });
const pdf = await download(pdfUrl, pdfPath);
assert.equal(digest(pdf), 'e636500050761fa8eeded69538f3fdf7ec9a9e9d6164a9c08a3e94305187846e',
  'The Berman PDF changed: review its image IDs and crop coordinates before importing.');
const pdfText = pdf.toString('latin1');
// The PDF uses an ICC-based CMYK colour space. A naked embedded JPEG is
// interpreted with inverted colours by browser decoders, so render page 3
// through Ghostscript's PDF colour management before extracting its pips.
// Ghostscript is an import-time dependency only, never part of the app.
await promisify(execFile)('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-r300',
  '-dFirstPage=3', '-dLastPage=3', `-sOutputFile=${fileURLToPath(pdfRenderedPath)}`, fileURLToPath(pdfPath)]);
const pdfRendered = await readFile(pdfRenderedPath);
const sourceCards = [];
for (const card of [...createDeck(), { id: 'back', name: 'Hrbtna stran' }]) {
  const file = `${card.id}.jpg`;
  let bytes, source, sourceCollection, sourceObject;
  if (pdfObjects[card.id]) {
    sourceObject = pdfObjects[card.id];
    const match = new RegExp(`(?:^|[\\r\\n])${sourceObject} 0 obj[\\r\\n]([\\s\\S]*?)stream\\r?\\n`).exec(pdfText);
    assert.ok(match && match[1].includes('/DCTDecode'), `PDF image ${sourceObject} changed`);
    const length = Number(match[1].match(/\/Length\s+(\d+)/)?.[1]);
    assert.ok(length > 1000);
    const start = match.index + match[0].length;
    bytes = pdf.subarray(start, start + length);
    source = pdfUrl;
    sourceCollection = 'Merrill C. Berman Collection, 1906 deck; 2024 illustrated catalogue, page 3';
    await writeFile(new URL(file, originals), bytes);
  } else {
    let suffix;
    if (card.id === 'back') suffix = 'r01';
    else if (card.suit === 'tarok') suffix = card.rank === 22 ? 'j01' : String(card.rank).padStart(2, '0');
    else if (card.rank >= 5) suffix = `${{ hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' }[card.suit]}${{ 5: 'J', 6: 'C', 7: 'Q', 8: 'K' }[card.rank]}`;
    else suffix = existingPips[card.id];
    assert.ok(suffix, `Missing source mapping: ${card.id}`);
    source = `${wwpcm}d02101${suffix}.jpg`;
    sourceCollection = 'World Web Playing Card Museum — WWPCM02101/01, Tarock No. 1 (1906)';
    bytes = await download(source, new URL(file, originals));
  }
  assert.equal(bytes.readUInt16BE(0), 0xffd8, `${card.id}: expected original JPEG`);
  sourceCards.push({
    id: card.id, file, title: card.name,
    kind: card.id === 'back' ? 'back' : card.suit === 'tarok' ? 'trump' : card.rank >= 5 ? 'court' : 'pip',
    ...(card.suit && card.suit !== 'tarok' && card.rank <= 4 ? { pipCount: Number(card.label) } : {}),
    source, sourceCollection,
    ...(sourceObject ? { sourceObject, sourcePage: 3, sourcePdfSha256: digest(pdf), quality: 'Original 125-pixel-wide embedded scan; lower resolution than the other faces.' } : {}),
    sourceBytes: bytes.length, sourceSha256: digest(bytes),
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const cards = [];
try {
  const page = await browser.newPage();
  for (const entry of sourceCards) {
    const bytes = await readFile(new URL(entry.file, originals));
    const rendered = await page.evaluate(async ({ src, crop }) => {
      const image = new Image(); image.src = src; await image.decode();
      const scan = document.createElement('canvas');
      scan.width = crop ? Math.round(crop[2]) : image.naturalWidth;
      scan.height = crop ? Math.round(crop[3]) : image.naturalHeight;
      const context = scan.getContext('2d', { willReadFrequently: true });
      if (crop) context.drawImage(image, ...crop, 0, 0, scan.width, scan.height);
      else context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, scan.width, scan.height);
      const channels = [[], [], []];
      for (let i = 0; i < pixels.data.length; i += 4) {
        const rgb = [...pixels.data.slice(i, i + 3)];
        if (Math.min(...rgb) > 125 && Math.max(...rgb) - Math.min(...rgb) < 90) {
          rgb.forEach((value, c) => channels[c].push(value));
        }
      }
      const paper = channels.map(values => {
        values.sort((a, b) => a - b);
        return values[Math.floor(values.length * .9)] ?? 255;
      });
      // A mild scan white balance preserves every original line and motif.
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.max(0, Math.min(255, 255 * (pixels.data[i + c] - 5) / (paper[c] - 5)));
      }
      context.putImageData(pixels, 0, 0);
      const canvas = document.createElement('canvas');
      canvas.width = 504; canvas.height = 904;
      const out = canvas.getContext('2d');
      out.fillStyle = '#fff'; out.fillRect(0, 0, canvas.width, canvas.height);
      out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
      const scale = Math.min(480 / scan.width, 880 / scan.height);
      const w = scan.width * scale, h = scan.height * scale;
      out.drawImage(scan, (504 - w) / 2, (904 - h) / 2, w, h);
      return { data: canvas.toDataURL('image/jpeg', .94), originalWidth: scan.width, originalHeight: scan.height, paperWhite: paper };
    }, entry.sourceObject
      ? { src: `data:image/png;base64,${pdfRendered.toString('base64')}`, crop: pdfRects[entry.id].map(value => value * 300 / 72) }
      : { src: `data:image/jpeg;base64,${bytes.toString('base64')}` });
    const output = Buffer.from(rendered.data.split(',')[1], 'base64');
    await writeFile(new URL(entry.file, destination), output);
    const originalHeight = entry.sourceObject
      ? Number(new RegExp(`(?:^|[\\r\\n])${entry.sourceObject} 0 obj[\\s\\S]*?/Height (\\d+)`).exec(pdfText)?.[1])
      : rendered.originalHeight;
    cards.push({ ...entry, width: 504, height: 904, originalWidth: entry.sourceObject ? 125 : rendered.originalWidth, originalHeight,
      bytes: output.length, sha256: digest(output), adjusted: true,
      correction: { paperWhite: rendered.paperWhite, blackPoint: 5, aspectRatioPreserved: true, background: '#ffffff',
        ...(entry.sourceObject ? { pdfColorManagement: 'Ghostscript png16m at 300dpi', pdfImageRect: pdfRects[entry.id] } : {}),
      },
      treatment: 'Conventional paper white balance and proportional placement on a white canvas. All original artwork retained; no generated illustration or pip reconstruction.',
    });
    console.log(`${entry.id}: ${rendered.originalWidth}×${rendered.originalHeight} → 504×904`);
  }
} finally { await browser.close(); }

const faces = cards.filter(card => card.id !== 'back');
assert.deepEqual(faces.map(card => card.id).sort(), createDeck().map(card => card.id).sort());
const metadata = {
  deck: 'Tarock No. 1 — Ditha Moser (1906)', artist: 'Ditha Moser', artworkDate: '1906',
  source: `${wwpcm}d02101.htm`, sourceCollection: 'WWPCM and the Merrill C. Berman Collection',
  retrieved: new Date().toISOString().slice(0, 10), artworkVersion: 1,
  rights: 'WWPCM provides no per-image reuse licence on the inspected source page. The Berman catalogue carries © 2024 The Merrill C. Berman Collection. These statements are recorded as published; no public-domain or open-licence claim is made.',
  note: 'All 54 faces reproduce real scans of the same 1906 design: 45 from WWPCM and nine lower-resolution pip scans from the Berman catalogue. The WWPCM back is included. The original narrow proportions and patterned pips are preserved.',
};
await writeFile(new URL('sources.json', originals), `${JSON.stringify({ ...metadata, cards: sourceCards.filter(c => c.id !== 'back'), back: sourceCards.find(c => c.id === 'back') }, null, 2)}\n`);
await writeFile(new URL('sources.json', destination), `${JSON.stringify({ ...metadata, cards: faces, back: cards.find(c => c.id === 'back') }, null, 2)}\n`);
console.log('Prepared 54 Moser faces and the matching back.');
