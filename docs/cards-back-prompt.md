# Card-back edit record

- Mode: built-in image editing, single edit of the user-supplied photograph.
- Input: `artifacts/piatnik-ornament-source.jpg` (local working artifact, excluded from Git), downloaded from the [user-supplied product photograph](https://pl.nice-cdn.com/upload/image/product/large/default/piatnik-soehne-tarok-karte-ornament-1-st-821748-sl.jpg).
- Output: `public/cards/back-ornament.png`.
- Card faces were not edited.

## Final prompt

```text
Use case: background-extraction
Asset type: a single flat card-back bitmap for the TarokZa2 web card game.
Input image 1 is the edit target: the user's Piatnik ornament tarok product photograph.
Primary request: Extract ONLY the complete blue-and-white ornamental back on the foreground card at the lower right. Straighten its clockwise rotation and rectify perspective into a flat upright portrait rectangle, with parallel vertical and horizontal edges, as if scanned directly from above. Use the actual card back visible on that card, not the design printed on the box.
Preserve invariants: faithfully retain the exact dark navy/blue-and-white ornamental artwork, its two mirrored urn motifs, scrollwork, the white outer card border and rounded corners. Preserve the pattern's arrangement and colors; this is extraction and straightening, not a redesign. Remove everything outside this one card: box, front-facing cards, tabletop and drop shadows. Do not add text or symbols. Do not invent a new back pattern.
Composition: one upright card only, portrait aspect ratio approximately 330:560, tightly filling the whole canvas edge-to-edge without outside margins; preserve the original white border inside the card. Outside its tiny rounded corners may be transparent. Output a clean flat card asset, not a staged product photo.
```
