import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createDeck } from '../shared/cards.mjs';

// Prepare two documented historical packs from the World Web Playing Card
// Museum. Only conventional crop, white balance and resampling are applied.
// Missing number cards are explicitly reconstructed from their own suit marks.
const configurations = {
  cego: { prefix: 'd02056', name: 'Adler-Cego · ASS', sourceFaces: 44,
    source: 'http://a.trionfi.eu/WWPCM/decks05/d02056/d02056.htm',
    historySource: 'https://www.cego.de/kartenblaetter#badischestarock',
    crop: [.0714, .0447, .8622, .9195], backCrop: [.075, .045, .85, .91],
    pips: { 'hearts-4': 'hA', 'hearts-3': 'h2', 'diamonds-4': 'dA', 'diamonds-3': 'd2', 'clubs-4': 'c10', 'spades-4': 's10' },
    symbols: { hearts: ['hA', .385, .445, .245, .135], diamonds: ['dA', .38, .42, .25, .17], clubs: ['c10', .125, .092, .24, .155], spades: ['s10', .115, .09, .255, .16] },
  },
  neumayer: { prefix: 'd02911', name: 'Češki tarok · OTK', sourceFaces: 38,
    source: 'http://a.trionfi.eu/WWPCM/decks05/d02911/d02911.htm',
    historySource: 'https://www.hracikarty.cz/produkty/standardni-karty/taroky-1720/',
    crop: [.0816, .049, .852, .909], backCrop: [.110, .080, .783, .855], pips: {},
    symbols: { hearts: ['hK', .095, .072, .278, .14], diamonds: ['dK', .095, .065, .265, .159], clubs: ['cK', .107, .065, .263, .145], spades: ['sK', .102, .070, .263, .150] },
  },
};
const suits = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
const courts = { 5: 'J', 6: 'C', 7: 'Q', 8: 'K' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requested = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
  const page = await browser.newPage();
  for (const [deckId, config] of Object.entries(configurations)) {
    if (requested.length && !requested.includes(deckId)) continue;
    const originals = new URL(`../artifacts/new-decks/${deckId}/originals/`, import.meta.url);
    const destination = new URL(`../public/cards/${deckId}/`, import.meta.url);
    await mkdir(originals, { recursive: true }); await mkdir(destination, { recursive: true });
    const entries = createDeck().flatMap(card => {
      const suffix = card.suit === 'tarok' ? (card.rank === 22 ? 'j01' : String(card.rank).padStart(2, '0'))
        : courts[card.rank] ? `${suits[card.suit]}${courts[card.rank]}` : config.pips[card.id];
      return suffix ? [{ id: card.id, title: card.name, suffix, kind: card.suit === 'tarok' ? 'trump' : card.rank >= 5 ? 'court' : 'pip', ...(card.rank <= 4 && card.suit !== 'tarok' ? { pipCount: Number(card.label) } : {}) }] : [];
    });
    assert.equal(entries.length, config.sourceFaces);
    entries.push({ id: 'back', title: 'Hrbtna stran', suffix: 'r01', kind: 'back' });
    const sources = [];
    for (const entry of entries) {
      const filename = `${config.prefix}${entry.suffix}.jpg`;
      const url = new URL(filename, config.source).href;
      let bytes;
      try { bytes = await readFile(new URL(filename, originals)); }
      catch {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TarokZa2 artwork import' } });
        assert.ok(response.ok, `${url}: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(new URL(filename, originals), bytes);
      }
      const result = await page.evaluate(async ({ src, entry, config }) => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 504; canvas.height = 904;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#fff'; context.fillRect(0, 0, 504, 904);
        const sw = image.naturalWidth, sh = image.naturalHeight;
        const crop = entry.kind === 'back' ? config.backCrop : entry.kind === 'pip' ? [.06, .04, .88, .92] : config.crop;
        const bounds = crop.map((value, index) => value * (index % 2 ? sh : sw));
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image, ...bounds, 20, 20, 464, 864);
        const data = context.getImageData(20, 20, 464, 864);
        const references = [[], [], []];
        for (let index = 0; index < data.data.length; index += 4) {
          const rgb = Array.from(data.data.subarray(index, index + 3));
          if (Math.min(...rgb) > 205 && Math.max(...rgb) - Math.min(...rgb) < 35) rgb.forEach((value, channel) => references[channel].push(value));
        }
        const paper = references.map(values => { values.sort((a, b) => a - b); return values[Math.floor(values.length * .65)] || 255; });
        for (let index = 0; index < data.data.length; index += 4) {
          for (let channel = 0; channel < 3; channel++) {
            const normalized = (data.data[index + channel] - 3) / (paper[channel] - 3);
            data.data[index + channel] = Math.max(0, Math.min(255, normalized * 255));
          }
          // Blank stock becomes exactly white; printed colors and linework remain.
          const rgb = Array.from(data.data.subarray(index, index + 3));
          if (Math.min(...rgb) > 244 && Math.max(...rgb) - Math.min(...rgb) < 10) data.data.set([255, 255, 255], index);
        }
        context.putImageData(data, 20, 20);
        return { data: canvas.toDataURL('image/jpeg', .94), width: sw, height: sh, bounds, paper };
      }, { src: `data:image/jpeg;base64,${bytes.toString('base64')}`, entry, config });
      const rendered = Buffer.from(result.data.split(',')[1], 'base64');
      const file = `${entry.id}.jpg`; await writeFile(new URL(file, destination), rendered);
      sources.push({ ...entry, file, source: url, description: config.source, width: 504, height: 904,
        bytes: rendered.length, sha256: digest(rendered), adjusted: true,
        sourceScan: { file: filename, width: result.width, height: result.height, bytes: bytes.length, sha256: digest(bytes) },
        correction: { script: 'scripts/prepare-collection-decks.mjs', crop: result.bounds, paperWhite: result.paper, background: '#ffffff' },
        treatment: 'Conventional crop of the printed face, paper-reference white balance and resampling on a white canvas; original illustration retained.' });
    }
    // Extract only the ink of one suit mark from each original pack.
    const symbols = {};
    for (const [suit, [suffix, ...crop]] of Object.entries(config.symbols)) {
      const filename = `${config.prefix}${suffix}.jpg`;
      const bytes = await readFile(new URL(filename, originals));
      symbols[suit] = await page.evaluate(async ({ src, crop, suit }) => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas');
        const bounds = crop.map((value, index) => Math.round(value * (index % 2 ? image.naturalHeight : image.naturalWidth)));
        canvas.width = bounds[2]; canvas.height = bounds[3];
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, ...bounds, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
        const red = ['hearts', 'diamonds'].includes(suit);
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4, [r, g, b] = data.data.subarray(i, i + 3);
          const alpha = red ? Math.max(0, Math.min(1, (r - (g + b) / 2 - 30) / 80)) : Math.max(0, Math.min(1, (180 - Math.max(r, g, b)) / 80));
          data.data[i + 3] = Math.round(alpha * 255);
        }
        // Keep the single connected suit mark, discarding isolated fragments
        // of a neighbouring crown or sceptre captured by the generous crop.
        const visited = new Uint8Array(canvas.width * canvas.height);
        let largest = [];
        for (let start = 0; start < visited.length; start++) {
          if (visited[start] || data.data[start * 4 + 3] < 8) continue;
          const component = [start]; visited[start] = 1;
          for (let cursor = 0; cursor < component.length; cursor++) {
            const current = component[cursor], x = current % canvas.width, y = Math.floor(current / canvas.width);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy, next = ny * canvas.width + nx;
              if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height || visited[next] || data.data[next * 4 + 3] < 8) continue;
              visited[next] = 1; component.push(next);
            }
          }
          if (component.length > largest.length) largest = component;
        }
        const retained = new Set(largest);
        for (let index = 0; index < visited.length; index++) {
          if (!retained.has(index)) { data.data[index * 4 + 3] = 0; continue; }
          const x = index % canvas.width, y = Math.floor(index / canvas.width);
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        context.putImageData(data, 0, 0);
        const output = document.createElement('canvas'); output.width = right - left + 1; output.height = bottom - top + 1;
        if (output.width < 15 || output.height < 15) throw new Error(`Missing ${suit} mark`);
        output.getContext('2d').drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
        return { data: output.toDataURL('image/png'), width: output.width, height: output.height, crop: bounds };
      }, { src: `data:image/jpeg;base64,${bytes.toString('base64')}`, crop, suit });
      symbols[suit].source = new URL(filename, config.source).href;
      await writeFile(new URL(`symbol-${suit}.png`, destination), Buffer.from(symbols[suit].data.split(',')[1], 'base64'));
    }
    const pair = y => [[.25, y], [.75, y]];
    const layouts = { 1: [[.5, .5]], 2: [[.5, .13], [.5, .87]], 3: [[.5, .13], [.5, .5], [.5, .87]], 4: [...pair(.13), ...pair(.87)],
      7: [...pair(.13), ...pair(.5), ...pair(.87), [.5, .315]],
      8: [...pair(.13), ...pair(.377), ...pair(.623), ...pair(.87)],
      9: [...pair(.13), ...pair(.377), ...pair(.623), ...pair(.87), [.5, .5]],
      10: [...pair(.13), ...pair(.377), ...pair(.623), ...pair(.87), [.5, .2535], [.5, .7465]] };
    const present = new Set(sources.map(card => card.id));
    for (const card of createDeck().filter(card => !present.has(card.id))) {
      assert.ok(card.suit !== 'tarok' && card.rank <= 4);
      const pipCount = Number(card.label), symbol = symbols[card.suit], positions = layouts[pipCount];
      assert.equal(positions.length, pipCount);
      const width = 112 * symbol.width / Math.max(symbol.width, symbol.height), height = 112 * symbol.height / Math.max(symbol.width, symbol.height);
      const uses = positions.map(([x, y]) => `  <use href="#pip" data-pip="${card.suit}" transform="translate(${x * 504} ${y * 904})${y > .5 ? ' rotate(180)' : ''}"/>`).join('\n');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="504" height="904" viewBox="0 0 504 904" role="img" aria-labelledby="name" data-card-id="${card.id}" data-pips="${pipCount}">\n<title id="name">${card.name}</title>\n<defs><g id="pip"><image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" href="${symbol.data}"/></g></defs>\n<rect width="504" height="904" fill="#fff"/>\n${uses}\n</svg>\n`;
      const bytes = Buffer.from(svg), file = `${card.id}.svg`; await writeFile(new URL(file, destination), bytes);
      sources.push({ id: card.id, title: card.name, file, kind: 'pip', generated: true, pipCount,
        source: symbol.source, description: config.source, width: 504, height: 904, bytes: bytes.length, sha256: digest(bytes),
        symbolFile: `symbol-${card.suit}.png`, symbolCrop: symbol.crop,
        treatment: 'Reconstructed pip card using the original pack’s extracted suit mark, exact pip count and white background; not an original scan.',
        generator: 'scripts/prepare-collection-decks.mjs' });
    }
    const cards = sources.filter(card => card.id !== 'back'), back = sources.find(card => card.id === 'back');
    assert.deepEqual(cards.map(card => card.id).sort(), createDeck().map(card => card.id).sort());
    const manifest = { deck: config.name, source: config.source, historySource: config.historySource,
      attribution: 'World Web Playing Card Museum, collection scans (WWPCM)',
      rights: 'The source catalogue does not state a reuse licence. No blanket licence is inferred for these scans.',
      retrieved: new Date().toISOString().slice(0, 10), artworkVersion: 1, sourceFaces: config.sourceFaces,
      note: `${config.sourceFaces} original face scans and the matching back are cropped and white-balanced. ${54 - config.sourceFaces} missing pip cards are explicitly reconstructed from the pack’s own suit marks. ${deckId === 'neumayer' ? 'The scan source identifies historical Kolín Taroky No.165; this is not a scan of the modern Hrací karty No.1720 edition.' : ''}`.trim(), cards, back };
    await writeFile(new URL('sources.json', destination), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${deckId}: ${config.sourceFaces} original faces, ${54 - config.sourceFaces} reconstructed pips, matching back`);
  }
} finally { await browser.close(); }
