# Complete tarok deck

All 54 card faces in the game, the in-game card reference, and the landing-page trula use scans of the S. Modiano **Tarok Študentski servis Maribor** deck, dated 1995 in Wikimedia Commons. The photographs are credited to **Martin Okrslar**, uploaded by **Mrtn-kamnik**. No generated card faces remain in the interface. The card back is the separately sourced Piatnik Ornament design described below.

The full source manifest is [public/cards/deck/sources.json](../public/cards/deck/sources.json). It records the exact Commons file and thumbnail URL for every card. [scripts/fetch-deck.mjs](../scripts/fetch-deck.mjs) downloads the pack reproducibly and refuses a source collection that does not map to exactly 54 distinct faces and one back.

## Mapping the printed cards

The internal ranks represent playing strength, not the pip count printed on the card. Existing card IDs and strength values are preserved so saved games can continue.

| Card group | Printed cards, strongest first | Internal ranks, strongest first |
| --- | --- | --- |
| Taroki | Škis, XXI, XX, …, I | 22, 21, 20, …, 1 |
| Figures in every suit | Kralj, dama, kaval, fant | 8, 7, 6, 5 |
| Heart/diamond pip cards | One, two, three, four suit symbols | 4, 3, 2, 1 |
| Spade/club pip cards | 10, 9, 8, 7 suit symbols | 4, 3, 2, 1 |

Card faces show the actual printed artwork, without added A/C/D/F indexes. The **Karte** reference displays the full Slovenian name below each card. A single heart/diamond is named *enka* in the interface; the [Tarok.net rules, section 2.1](https://www.tarok.net/pravila108.pdf) also call this card *as*. The former letters F, C, D, K represented fant, cavalier/kaval, dama, kralj; they were UI shorthand, not extra cards.

## Example source files

| Local asset | Wikimedia Commons source |
| --- | --- |
| `public/cards/pagat.jpg` | [Pagat I](https://commons.wikimedia.org/wiki/File:SPKW-Q2171-IMG_8529-tarock-1.jpg) |
| `public/cards/mond.jpg` | [Mond XXI](https://commons.wikimedia.org/wiki/File:SPKW-Q2171-IMG_8563-tarock-21.jpg) |
| `public/cards/skis.jpg` | [Škis](https://commons.wikimedia.org/wiki/File:SPKW-Q2171-IMG_8561-tarock-skus.jpg) |

Each source page marks the scan as public domain using **PD-old-100** and the [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/). This records Commons' classification; the deck's 1995 date is not itself a claim that copyright expired in that year. The pages do not identify the original individual artist's dates and note the absence of a separate US public-domain tag.

The local face assets are Commons' 330-pixel-wide JPEG thumbnails, downloaded on 2026-09-05. They are served locally without an external image dependency and preserve the complete artwork. No face artwork was redrawn, recolored, or generated. The three earlier landing-page files remain in `public/cards/`; the current interface uses the 54 faces in `public/cards/deck/`. The original Modiano `back.jpg` is retained for provenance but is no longer displayed.

Suggested credit: Karte: S. Modiano, Tarok Študentski servis Maribor (1995). Fotografije: Martin Okrslar, Wikimedia Commons; označeno kot javna domena (PDM 1.0). Pomanjšano za prikaz.

Canonical names and image paths live in [shared/cards.mjs](../shared/cards.mjs). Player views normalize older saved display metadata by card ID, without changing hands, strengths, scores, or turns.

## Display proportions

Every card and stack slot uses the **63:113 width-to-height ratio** of the user's Piatnik Ornament reference. [Piatnik's product specification](https://www.piatnik.com/spiele/spielkarten/regionale-karten/tarockkarten-ornament) lists 63 × 113 mm for article 193514 (No. 1935). The ratio is shared through CSS custom properties, including hand cards, exposed stacks, hidden cards, trick cards, the landing page and the card reference. In-game heights are retained while widths are reduced. Images use centered `object-fit: cover` to fill the frame without stretching or mismatched bands above and below the scan. This clips only the outer paper margins (under 5% per side, checked across all 54 faces); ranks and illustrations remain visible. Source image files are unchanged. Card faces stay opaque, including disabled cards, so overlapping edges cannot show through. A single fine warm edge, subtle surface highlight, and soft contact shadows give the cards depth without obscuring the scans. Corner rounding scales with card size. Playable cards have sage outlines, mouse hover lifts only enabled cards, and keyboard focus has a distinct outer ring. Reduced-motion preferences disable transitions.

## Piatnik Ornament card back

All face-down cards use [public/cards/back-ornament.png](../public/cards/back-ornament.png), derived from the foreground card in the [product photograph supplied by the user](https://pl.nice-cdn.com/upload/image/product/large/default/piatnik-soehne-tarok-karte-ornament-1-st-821748-sl.jpg) on 2026-09-05. The original downloaded photograph is retained locally at `artifacts/piatnik-ornament-source.jpg`; this working artifact is excluded from Git. The linked source photograph remains the provenance reference for repository readers.

The built-in image-editing tool isolated and straightened the blue-and-white ornamental back for a flat portrait game asset. This is an AI-assisted extraction, not an unmodified scan or a pixel-exact perspective crop. The 54 face scans, their identities, and game rules are unchanged. The photograph is a separate user-supplied source; the Commons public-domain classification above does not apply to this back. No redistribution license or permission for this back is documented in this project.

The asset has a separate path outside the downloaded deck, so rerunning `scripts/fetch-deck.mjs` cannot overwrite it. The exact edit instructions are recorded in [cards-back-prompt.md](cards-back-prompt.md).
