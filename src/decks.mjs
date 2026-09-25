import { cardFor, createDeck, CARD_ART_VERSION } from '../shared/cards.mjs';

export const DECK_STORAGE_KEY = 'tarokza2.deck';
export const DEFAULT_DECK = 'modiano';
export const CARD_DECKS = Object.freeze([
  Object.freeze({ id: 'modiano', name: 'Modiano · Maribor' }),
  Object.freeze({ id: 'slovenian', name: 'Slovenski tarok · Piatnik' }),
]);
const deckIds = new Set(CARD_DECKS.map(deck => deck.id));
const validDeck = value => deckIds.has(value) ? value : DEFAULT_DECK;

export const CARD_BACK_IMAGE = `/cards/back-ornament.png?v=${CARD_ART_VERSION}`;

/** Artwork is a browser preference; canonical card metadata and game saves stay unchanged. */
export function cardImage(value, deck = selectedDeck) {
  const card = cardFor(typeof value === 'string' ? value : value?.id);
  if (!card) return null;
  if (validDeck(deck) === 'modiano') return card.image;
  const extension = card.suit !== 'tarok' && card.rank <= 4 ? 'svg' : 'jpg';
  return `/cards/slovenian/${card.id}.${extension}?v=1`;
}

export function cardImageUrls(deck = selectedDeck) {
  return [CARD_BACK_IMAGE, ...createDeck().map(card => cardImage(card, deck))];
}

function savedDeck() {
  try { return validDeck(window.localStorage.getItem(DECK_STORAGE_KEY)); }
  catch { return DEFAULT_DECK; }
}

let selectedDeck = savedDeck();
const listeners = new Set();
export const getDeck = () => selectedDeck;
export const subscribeDeck = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function applyDeck(deck) {
  if (selectedDeck === deck) return;
  selectedDeck = deck;
  listeners.forEach(listener => listener());
}

export function setDeck(deck) {
  if (!deckIds.has(deck)) return;
  try { window.localStorage.setItem(DECK_STORAGE_KEY, deck); }
  catch { /* The choice still works for this visit when storage is unavailable. */ }
  applyDeck(deck);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === DECK_STORAGE_KEY || event.key === null) applyDeck(validDeck(event.newValue));
  });
}
