// Browser-safe canonical metadata for the 54-card Slovenian tarok deck.
// Strength and point values: https://www.tarok.net/pravila108.pdf, §2.1.
// The source calls the red single-pip card an "as". We display its physical
// pip value, 1 (Enka), rather than an A. Full court names replace the previous
// F = fant, C = cavalier/kaval, D = dama and K = kralj abbreviations.
// Bump when replacing artwork so permanent browser caches receive the new edition.
export const CARD_ART_VERSION = '1';

const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
const courts = ['Fant', 'Kaval', 'Dama', 'Kralj'];

function definitions() {
  const cards = Array.from({ length: 22 }, (_, index) => {
    const rank = index + 1;
    return {
      id: `tarok-${rank}`, suit: 'tarok', rank,
      label: rank === 22 ? 'ŠKIS' : romans[index], symbol: '✦',
      name: rank === 1 ? 'Pagat' : rank === 21 ? 'Mond' : rank === 22 ? 'Škis' : `Tarok ${romans[index]}`,
      points: [1, 21, 22].includes(rank) ? 5 : 1,
    };
  });
  for (const [suit, symbol, noun, red] of [
    ['clubs', '♣', 'križa', false], ['spades', '♠', 'pika', false],
    ['hearts', '♥', 'srca', true], ['diamonds', '♦', 'kare', true],
  ]) {
    const pips = red ? ['4', '3', '2', '1'] : ['7', '8', '9', '10'];
    const pipNames = red ? ['Štirica', 'Trojka', 'Dvojka', 'Enka'] : ['Sedmica', 'Osmica', 'Devetica', 'Desetica'];
    const labels = [...pips, ...courts];
    const names = [...pipNames, ...courts];
    for (let index = 0; index < 8; index++) {
      const rank = index + 1;
      cards.push({ id: `${suit}-${rank}`, suit, rank, label: labels[index], symbol, name: `${names[index]} ${noun}`, points: Math.max(1, rank - 3) });
    }
  }
  return cards.map(card => Object.freeze({ ...card, image: `/cards/deck/${card.id}.jpg?v=${CARD_ART_VERSION}` }));
}

const canonicalCards = Object.freeze(definitions());

export const CARD_BY_ID = Object.freeze(Object.fromEntries(canonicalCards.map(card => [card.id, card])));

/** Return immutable metadata for a known card ID, or null for an unknown ID. */
export function cardFor(id) {
  return Object.hasOwn(CARD_BY_ID, id) ? CARD_BY_ID[id] : null;
}

/** Fresh mutable cards for a deal; changes cannot affect the shared catalogue. */
export function createDeck() {
  return canonicalCards.map(card => ({ ...card }));
}
