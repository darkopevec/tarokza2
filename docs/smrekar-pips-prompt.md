# Smrekar tarok pip cards

Thirteen pip cards are absent from the Commons collection: all four hearts,
diamonds 2–4, clubs 8–10 and spades 8–10. Only these faces are reconstructed;
the 41 available faces and original back use the surviving source artwork.

The built-in imagegen tool extracted a transparent four-symbol atlas from
the high-resolution original Commons files corresponding to `hearts-8.jpg`,
`diamonds-4.jpg`, `clubs-1.jpg` and `spades-1.jpg`, in that order. Original
download URLs are recorded in `public/cards/smrekar/sources.json`. Local
reference copies are retained under `artifacts/smrekar-deck/sources/` (not
committed). The selected atlas is `public/cards/smrekar/suit-symbols.png`.
This is an AI-assisted extraction, not a pixel-exact crop.

`node scripts/build-smrekar-pips.mjs` trims transparent sprite padding,
downsamples the marks and embeds them in self-contained SVGs. The shield's
diagonal band, spearhead's collar, sword hilt and serrated leaf are retained.
The card layouts use exact pip counts with lower symbols rotated. All
reconstructed platlci have a uniform white (`#ffffff`) background, as
requested; no paper gradients or scan colors are sampled. No new borders,
text indexes or manufacturer marks are added. The
committed atlas is needed for exact reproduction; regenerating it with AI
can change the artwork.

## Built-in imagegen prompt

> Use case: background-extraction. Asset type: one square 2-by-2 transparent
> suit-symbol sprite atlas for the historic Hinko Smrekar tarok deck. The
> four inputs are source cards, not style suggestions. Extract exactly ONE
> upright suit symbol from EACH reference, preserving the distinctive
> printed silhouette and interior markings. Put exactly FOUR isolated
> symbols on a genuinely transparent background: upper-left quarter = the
> shield at the upper-left of input1 (hearts king), upper-right quarter =
> the single red spearhead symbol of input2, lower-left quarter = the
> upper-left black sword-hilt symbol of input3, lower-right quarter = the
> upper-left black serrated leaf of input4. Center each at the center of
> its quarter and fit within 32% width and 32% height of the complete
> canvas with ample transparent clearance. Shield: red pointed heraldic
> shield with the rectangular notch at the top center and the distinctive
> sloping pale-white and blue-gray band going from upper-left toward
> lower-right across its upper half; keep this colored band! Spearhead:
> red four-point curved-sided spearhead/lozenge with a small rounded collar
> and short rectangular nub beneath the lower point. Sword-hilt: solid
> almost-black shape with rounded knob at the TOP, short thick vertical
> handle, crossguard curling DOWNWARD into round knobs on both sides, and
> short fork-notched blade pointing DOWN. Leaf: almost-black broad pointed
> serrated-edge leaf with two rounded lower lobes and short narrow stalk
> at bottom, maintain its jagged outline; not a smooth ordinary spade
> glyph. Keep the four actual source shapes, approximate antique ink
> colors, asymmetric hand-printed details and orientation. Remove the
> surrounding paper, photos, figures and other pips. No card rectangles,
> no printed borders, no text or labels, no watermark, no shadows, no
> extra symbols. Do not replace any mark with standard
> heart/diamond/club/spade font glyphs. Flat upright game sprite on actual
> alpha transparency.
