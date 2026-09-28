# Tarok card decks

The game offers six complete 54-card decks: **Modiano**, the default, **Slovenski tarok · Piatnik**, **Smrekarjev tarok · Hinko Smrekar**, **Secesijski tarok · Ditha Moser**, **Adler-Cego · ASS**, and **Češki tarok · OTK 165**. Open the **Cards** icon, then **Card deck** to change the artwork for the game and card reference. The choice is saved only in the current browser and does not affect another player's choice or the game's rules, card identities, or saved hands. Modiano and Slovenski tarok use the Piatnik Ornament back described below; the other four decks use their own matching backs.

Each deck has a short description and history with links to the online sources. These appear above the gallery in all 12 interface languages. The factual copy and links live in [src/deck-stories.mjs](../src/deck-stories.mjs); [deck-history.md](deck-history.md) records the source-to-claim mapping and date distinctions. Historical descriptions concern the original decks; the digital artwork adaptations remain documented separately below.

## Modiano

The default deck uses scans of S. Modiano **Tarok Študentski servis Maribor**, dated 1995 in Wikimedia Commons. The photographs are credited to **Martin Okrslar**, uploaded by **Mrtn-kamnik**. All 54 faces are conventionally restored from the full-resolution source photographs, retrieved on 2026-09-26.

The full source manifest is [public/cards/deck/sources.json](../public/cards/deck/sources.json). It records each Commons description page, original and thumbnail URLs, source dimensions and hash, displayed dimensions and hash, and correction parameters. [scripts/fetch-deck.mjs](../scripts/fetch-deck.mjs) retains the original photographs in `artifacts/modiano-deck/originals/` and refuses a source collection that does not map to exactly 54 distinct faces and one back. It reuses complete downloads and respects source throttling.

[scripts/restore-modiano-deck.mjs](../scripts/restore-modiano-deck.mjs) detects the printed outline, corrects perspective, balances paper color, and fits the original drawing proportionally inside a **504 × 904** white canvas. The pip cards have white backgrounds, with isolated dust and non-ink stains removed. Printed ranks, physical pip counts, illustrations and the Modiano maker's mark remain. The original sources stay separate from displayed assets, and face URLs use revision `v=2` to refresh browser caches. Rebuild with the importer followed by the restoration script.

## Mapping the printed cards

The internal ranks represent playing strength, not the pip count printed on the card. Existing card IDs and strength values are preserved so saved games can continue.

| Card group | Printed cards, strongest first | Internal ranks, strongest first |
| --- | --- | --- |
| Taroki | Škis, XXI, XX, …, I | 22, 21, 20, …, 1 |
| Figures in every suit | Kralj, dama, kaval, fant | 8, 7, 6, 5 |
| Heart/diamond pip cards | One, two, three, four suit symbols | 4, 3, 2, 1 |
| Spade/club pip cards | 10, 9, 8, 7 suit symbols | 4, 3, 2, 1 |

Card faces have no added A/C/D/F indexes. The card reference displays the full name below each card in the selected interface language. A single heart/diamond is named *enka* in Slovenian; the [Tarok.net rules, section 2.1](https://www.tarok.net/pravila108.pdf) also call this card *as*. The former letters F, C, D, K represented fant, cavalier/kaval, dama, kralj; they were UI shorthand, not extra cards.

## Example source files

| Local asset | Wikimedia Commons source |
| --- | --- |
| `public/cards/pagat.jpg` | [Pagat I](https://commons.wikimedia.org/wiki/File:SPKW-Q2171-IMG_8529-tarock-1.jpg) |
| `public/cards/mond.jpg` | [Mond XXI](https://commons.wikimedia.org/wiki/File:SPKW-Q2171-IMG_8563-tarock-21.jpg) |
| `public/cards/skis.jpg` | [Škis](https://commons.wikimedia.org/wiki/File:SPKW-Q2171-IMG_8561-tarock-skus.jpg) |

Each source page marks the scan as public domain using **PD-old-100** and the [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/). This records Commons' classification; the deck's 1995 date is not itself a claim that copyright expired in that year. The pages do not identify the original individual artist's dates and note the absence of a separate US public-domain tag.

The local face assets were originally Commons' 330-pixel-wide JPEG thumbnails, downloaded on 2026-09-05. The current restored faces use the larger originals and are served locally without an external image dependency. No illustration was generated or redrawn. The three earlier landing-page files remain in `public/cards/`; the current interface uses the 54 restored faces in `public/cards/deck/`. The unused original Modiano `back.jpg` is retained without alteration. Its existing source entry concerns the original thumbnail, not the restoration.

Suggested credit: Karte: S. Modiano, Tarok Študentski servis Maribor (1995). Fotografije: Martin Okrslar, Wikimedia Commons; označeno kot javna domena (PDM 1.0). Konvencionalna poprava perspektive, beline in ozadja.

Canonical names and image paths live in [shared/cards.mjs](../shared/cards.mjs). Player views normalize older saved display metadata by card ID, without changing hands, strengths, scores, or turns.

## Slovenski tarok · Piatnik

The optional Slovenian deck uses the 22 trumps and 16 court cards published in the [Slovenski tarok gallery](https://slovenski-tarok.si/). Its [history page](https://slovenski-tarok.si/zgodovina) credits **Matjaž Schmidt** with the illustrations, **Janez Bogataj** with the concept, **Eurotrade Commerce d.o.o.** with commissioning the deck, and **Piatnik, Vienna** with printing it. Schmidt began the illustrations in 1995; this is not a confirmed publication date.

[scripts/fetch-slovenian-deck.mjs](../scripts/fetch-slovenian-deck.mjs) downloads the gallery's 38 original JPEGs unchanged to [public/cards/slovenian/](../public/cards/slovenian/). It checks that each source is present in the gallery and maps to the expected canonical card ID. [sources.json](../public/cards/slovenian/sources.json) records the exact URLs, 200 × 358 pixel dimensions, byte sizes, and SHA-256 checksums. The source does not state a reuse licence; the Wikimedia Commons classification for the Modiano scans does not apply to this deck.

The gallery does not supply the 16 low suit cards (*platlci*). Their suit symbols were extracted from the four Slovenian kings using the built-in image-editing tool and saved in [suit-symbols.png](../public/cards/slovenian/suit-symbols.png). This is an AI-assisted extraction rather than a pixel-exact crop. The exact prompt and references are recorded in [slovenian-pips-prompt.md](slovenian-pips-prompt.md).

[scripts/build-slovenian-pips.mjs](../scripts/build-slovenian-pips.mjs) assembles those symbols into SVG faces with the exact pip counts: one through four for hearts and diamonds, seven through ten for clubs and spades. Each SVG embeds its symbols and can be served locally without loading an external image. These 16 cards are reconstructed artwork; the 38 source faces remain unchanged. The importer preserves generated-card manifest entries when refreshing the source JPEGs.

To rebuild the optional deck, run the importer first and the pip generator second:

```sh
node scripts/fetch-slovenian-deck.mjs
node scripts/build-slovenian-pips.mjs
```

## Smrekarjev tarok · Hinko Smrekar

The optional Smrekar deck uses Hinko Smrekar's **Slovanski tarok**, dated **1910–1912** by the [National Gallery of Slovenia](https://smrekar.ng-slo.si/slovanski-tarok/). The gallery identifies the commissioner as Prva slovanska tovarna igralnih kart in Ljubljana and describes the cards' Slavic historical and folk motifs.

[scripts/fetch-smrekar-deck.mjs](../scripts/fetch-smrekar-deck.mjs) imports **41 faces and the matching card back** from [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Smrekar%27s_Tarot): all 22 trumps, all 16 court cards, the diamond one, and the club and spade sevens. It caches the unchanged 500-pixel-wide Commons JPEG thumbnails in `artifacts/smrekar-deck/originals/`, outside the served deck. The per-file pages classify these scans as public domain under **PD-Art (PD-old-auto-expired)**; this records Commons' classification for these particular files.

[scripts/restore-smrekar-deck.mjs](../scripts/restore-smrekar-deck.mjs) prepares the 41 source faces and back for display using conventional perspective correction, white balance, and tonal curves. The adjusted JPEGs have a consistent **504 × 904 pixel** canvas, white paper edges, and white margins. The three surviving platlci also have uniform white backgrounds. These corrections retain the scanned drawing; they do not generate replacement illustrations or invent details already missing from a source scan. The settings are recorded in [scripts/smrekar-restoration.json](../scripts/smrekar-restoration.json).

[public/cards/smrekar/sources.json](../public/cards/smrekar/sources.json) records each file's exact source and full-resolution URLs and Commons description page, with the back recorded separately. Each adjusted entry's `sourceScan` records the original scan's dimensions, byte size, and SHA-256 hash; the top-level dimensions, size, and hash describe the adjusted file served by the game. Smrekar image URLs use version `v=2` so browsers refresh previously cached artwork.

The remaining **13 platlci** are reconstructed from this deck's four suit symbols using an AI-assisted extraction saved as [suit-symbols.png](../public/cards/smrekar/suit-symbols.png). The references and exact extraction prompt are recorded in [smrekar-pips-prompt.md](smrekar-pips-prompt.md). [scripts/build-smrekar-pips.mjs](../scripts/build-smrekar-pips.mjs) assembles the existing extracted symbols into self-contained SVG faces with the correct physical pip counts and a uniform white background. The symbols and layouts are unchanged by the background correction. This generator leaves the three restored original pip scans intact. The manifest distinguishes reconstructed faces from adjusted source scans and records the atlas hash and source card used for each suit.

To rebuild this deck, download the original scans, restore them, then generate the missing platlci:

```sh
node scripts/fetch-smrekar-deck.mjs
node scripts/restore-smrekar-deck.mjs
node scripts/build-smrekar-pips.mjs
```

Suggested credit: Karte: Hinko Smrekar, Slovanski tarok (1910–1912). Izvirne karte in hrbet: Wikimedia Commons, PD-Art (PD-old-auto-expired). Trinajst platlcev je rekonstruiranih iz znakov barv na izvirnih kartah.

## Secesijski tarok · Ditha Moser

[scripts/fetch-moser-deck.mjs](../scripts/fetch-moser-deck.mjs) prepares all 54 real faces and the matching back of Moser's 1906 design. The [World Web Playing Card Museum catalogue](http://a.trionfi.eu/WWPCM/decks05/d02101/d02101.htm) supplies 45 faces and the back. Nine missing pip faces come from page 3 of the [Merrill C. Berman Collection's illustrated catalogue](https://static1.squarespace.com/static/5e68e6f8d34bcf00a52fd5a6/t/65b01721fab15431760bad07/1706039073712/MCB%2BDitha%2BMoser%2BTarock.pdf). These are authentic scans of the same design, including its patterned pip backgrounds, rather than invented replacements.

The nine PDF pip images have a native width of only 125 pixels and remain less sharp. The importer pins the PDF hash and records its image objects and crop coordinates. **Ghostscript** is required when rebuilding, to render the PDF's CMYK color profile correctly; it is not an application dependency. All images retain their narrow proportions on a 504 × 904 canvas. [sources.json](../public/cards/moser/sources.json) records each source, native resolution, output hash and conventional white-balance treatment. WWPCM states no per-image reuse licence; the Berman catalogue carries its 2024 collection copyright notice. Neither is represented as openly licensed.

## Adler-Cego · ASS

[scripts/prepare-collection-decks.mjs](../scripts/prepare-collection-decks.mjs) imports 44 faces and the back from [WWPCM's Adler-Cego catalogue](http://a.trionfi.eu/WWPCM/decks05/d02056/d02056.htm). This includes all 22 trumps, 16 courts and six pip cards. Ten missing pips are reconstructed as self-contained SVGs from conventional extractions of this pack's own suit symbols, retaining the exact physical pip counts. They are explicitly marked as generated in [sources.json](../public/cards/cego/sources.json). The animal trumps use Arabic numbers; the unnumbered Gstieß maps to the game's Škis. Game strengths and rules are unchanged.

## Češki tarok · OTK 165

The same preparation script imports 38 illustrated faces and a matching back from [WWPCM's historical Kolín Taroky No. 165 catalogue](http://a.trionfi.eu/WWPCM/decks05/d02911/d02911.htm). All 16 pip cards are reconstructed from suit marks on the same source courts. A separately dated 1950 ace on the collection page is excluded to avoid mixing editions. The displayed name is **Češki tarok · OTK 165**: these are not scans of the modern Hrací karty No. 1720 product. No printing year is inferred for the photographed edition. [sources.json](../public/cards/neumayer/sources.json) records the distinction and every source/adaptation.

Both collection imports use conventional crops and paper white balance on 504 × 904 white canvases. WWPCM states no reuse licence on the inspected catalogue pages; the manifests record this without inferring a blanket public-domain classification. Rebuild with `node scripts/prepare-collection-decks.mjs`, optionally followed by `cego` or `neumayer`. All artwork is served locally; source collections are never requested by the running game.

## Other requested decks awaiting artwork

**Chinesen Tarock** (Estel, Vienna 1820) and **Tarock mit Berufsdarstellungen** (Steiger, Vienna circa 1849; Piatnik 281198) are verified historical packs, but only incomplete sample images were located. They are not exposed as selectable decks. See [deck-research.md](deck-research.md) for sources and the remaining artwork requirements.

## Display proportions

Every card and stack slot uses the **63:113 width-to-height ratio** of the user's Piatnik Ornament reference. [Piatnik's product specification](https://www.piatnik.com/spiele/spielkarten/regionale-karten/tarockkarten-ornament) lists 63 × 113 mm for article 193514 (No. 1935). The ratio is shared through CSS custom properties, including hand cards, exposed stacks, hidden cards, trick cards, the landing page and the card reference. In-game heights are retained while widths are reduced. Images use centered `object-fit: cover` to fill the frame without stretching or mismatched bands above and below the scan. The Slovenian faces closely match the display ratio and their source JPEGs remain unchanged. Modiano, Smrekar and the three newly prepared decks use the exact display canvas ratio, with white margins keeping their available artwork visible inside the frame. Narrow Moser artwork retains its source proportions within that canvas. Card faces stay opaque, including disabled cards, so overlapping edges cannot show through. A single fine warm edge, subtle surface highlight, and soft contact shadows give the cards depth without obscuring the scans. Corner rounding scales with card size. Playable cards have sage outlines, mouse hover lifts only enabled cards, and keyboard focus has a distinct outer ring. Reduced-motion preferences disable transitions.

## Piatnik Ornament card back

Face-down cards in the Modiano and Slovenski tarok decks use [public/cards/back-ornament.png](../public/cards/back-ornament.png), derived from the foreground card in the [product photograph supplied by the user](https://pl.nice-cdn.com/upload/image/product/large/default/piatnik-soehne-tarok-karte-ornament-1-st-821748-sl.jpg) on 2026-09-05. The original downloaded photograph is retained locally at `artifacts/piatnik-ornament-source.jpg`; this working artifact is excluded from Git. The linked source photograph remains the provenance reference for repository readers.

The built-in image-editing tool isolated and straightened the blue-and-white ornamental back for a flat portrait game asset. This is an AI-assisted extraction, not an unmodified scan or a pixel-exact perspective crop. The 54 face scans, their identities, and game rules are unchanged. The photograph is a separate user-supplied source; the Commons public-domain classification above does not apply to this back. No redistribution license or permission for this back is documented in this project.

The asset has a separate path outside the downloaded deck, so rerunning `scripts/fetch-deck.mjs` cannot overwrite it. The exact edit instructions are recorded in [cards-back-prompt.md](cards-back-prompt.md).
