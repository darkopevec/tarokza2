import { createDeck, CARD_ART_VERSION } from '../shared/cards.mjs';

export const CARD_BACK_IMAGE = `/cards/back-ornament.png?v=${CARD_ART_VERSION}`;
export const CARD_IMAGE_URLS = [CARD_BACK_IMAGE, ...createDeck().map(card => card.image)];

// Keep decoded images alive for pile reveals and cards moving between regions.
// Share in-flight work, including React StrictMode's repeated effects.
const images = new Map();
let deckPromise;
let visibleWork = Promise.resolve();

export function registerCardCache() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/card-cache-sw.js').catch(() => {});
  }
}

async function persistImage(url) {
  try {
    const cache = await caches.open('tarok-card-art-v1');
    if (await cache.match(url)) return;
    // The first page may not yet be controlled by the service worker.
    const response = await fetch(url, { cache: 'force-cache', priority: 'low' });
    if (response.ok && response.headers.get('content-type')?.startsWith('image/')) await cache.put(url, response);
  } catch { /* Images still work when browser storage is unavailable or full. */ }
}

function prepareImage(url, priority = 'low') {
  if (images.has(url)) return images.get(url).promise;
  const image = new Image();
  image.decoding = 'sync';
  image.fetchPriority = priority;
  const entry = { image, promise: null };
  entry.promise = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Nalaganje kart je trajalo predolgo.')), 20000);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (error) {
        images.delete(url);
        reject(error);
      } else resolve();
    };
    image.onload = () => image.decode().then(() => persistImage(url)).then(() => finish(), finish);
    image.onerror = () => finish(new Error('Slike kart ni bilo mogoče naložiti.'));
    image.src = url;
  });
  images.set(url, entry);
  return entry.promise;
}

export async function prepareCardImages(visible = []) {
  // Let the cards already rendered on the table finish before warming the rest.
  const foreground = Promise.allSettled([...new Set(visible)].map(url => prepareImage(url, 'high')));
  visibleWork = Promise.all([visibleWork, foreground]);
  await foreground;
  if (deckPromise) return deckPromise;
  const pending = CARD_IMAGE_URLS.filter(url => !images.has(url));
  deckPromise = Promise.all(Array.from({ length: 2 }, async () => {
    while (pending.length) {
      await visibleWork;
      if (!pending.length) break;
      try { await prepareImage(pending.shift()); } catch { /* Retry on the next table update. */ }
    }
  })).finally(() => { deckPromise = null; });
  return deckPromise;
}
