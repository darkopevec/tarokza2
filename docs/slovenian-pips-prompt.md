# Slovenian tarok pip cards

The publisher's gallery supplies 38 faces but no pip cards. The 16 missing
platlci are reconstructed: hearts and diamonds 1–4, clubs and spades 7–10.
They use a transparent suit atlas extracted with the built-in imagegen tool
from the upper-left suit marks of the four original kings. This is an
AI-assisted extraction, not a pixel-exact crop or an original Piatnik scan.

The selected output is retained at
`public/cards/slovenian/suit-symbols.png`. The inputs are the unchanged
`hearts-8.jpg`, `diamonds-8.jpg`, `clubs-8.jpg` and `spades-8.jpg` files in that
directory, in that order. Their original URLs are in `sources.json`.

`node scripts/build-slovenian-pips.mjs` trims transparent sprite padding,
downsamples each symbol and embeds it in self-contained SVGs. SVG placement
sets exact pip counts and rotates lower symbols. No added letter indexes or
invented manufacturer marks appear. The white paper and fine yellow frame
follow the source cards. All 16 SVGs remain usable offline without fetching
an external image, font or sprite. The committed atlas is required to
reproduce these exact outputs; regenerating it with AI may change its shapes.

## Built-in imagegen prompt

> Use case: background-extraction. Asset type: one square 2-by-2 suit-symbol
> sprite atlas for a card game. The four input images are the source cards of
> the Slovenian tarok deck. Extract ONLY the upright suit mark at the
> upper-left of each source card, preserving its exact silhouette,
> proportions, ink color, and flat printed appearance. No character
> illustrations and no card borders. Put exactly FOUR separate symbols on a
> genuinely transparent background: heart centered at 25% width/25% height,
> diamond at 75% width/25% height, club at 25% width/75% height, spade at 75%
> width/75% height. Each symbol fits within a 32%-wide and 32%-tall area
> centered within its own quarter, with ample transparent clearance. Heart
> is the red-orange source heart with two round lobes and a long point;
> diamond is the red-orange four-point source diamond whose four edges curve
> inward; club and spade are the almost-black source symbols with the
> distinctive wide concave-sided flared stem foot. Preserve the four
> original shapes from the cards, do not replace them with font glyphs or
> generic suit icons. Output a clean flat sprite sheet with real alpha, no
> outlines, no shadows, no gradients, no texture, no labels, no text, no
> watermark, no extra symbols.
