# Bundled fonts

TarokZa2 serves its fonts from `public/fonts/`, so playing does not contact Google Fonts or require a third-party font service.

| Family | Local asset | Variable weight range | License |
| --- | --- | --- | --- |
| DM Sans | `/fonts/dm-sans-variable.woff2` | 100–1000 | `public/fonts/OFL-DM-Sans.txt` |
| Manrope | `/fonts/manrope-variable.woff2` | 200–800 | `public/fonts/OFL-Manrope.txt` |

Both normal-style variable fonts come from the official [Google Fonts repository](https://github.com/google/fonts). The complete fonts retain their glyph sets, including Slovenian č, š and ž. DM Sans also retains its optical-size axis (9–40). WOFF2 compression changes the container format without subsetting or instantiating the fonts.

The browser downloads 142,788 bytes in total: 89,116 bytes for DM Sans and 53,672 bytes for Manrope. Original TrueType files remain beside the web assets for reproducibility; the complete font directory, including licenses, is below 560 KB. Both WOFF2 files were checked with `file` and `fc-scan`, including the Slovenian character ranges.

Source files:

- [DM Sans variable TrueType](https://github.com/google/fonts/blob/main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf), [metadata](https://github.com/google/fonts/blob/main/ofl/dmsans/METADATA.pb), [license](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt).
- [Manrope variable TrueType](https://github.com/google/fonts/blob/main/ofl/manrope/Manrope%5Bwght%5D.ttf), [metadata](https://github.com/google/fonts/blob/main/ofl/manrope/METADATA.pb), [license](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt).

The corresponding copyright notices and SIL Open Font License 1.1 are bundled unchanged. Rebuild the web assets after changing fonts so the Docker image includes them.

```css
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: url('/fonts/dm-sans-variable.woff2') format('woff2');
}

@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url('/fonts/manrope-variable.woff2') format('woff2');
}
```

To reproduce the container conversion, download the linked TrueType files and run `woff2_compress dm-sans-variable.ttf` and `woff2_compress manrope-variable.ttf`. Retain each corresponding license when distributing the resulting WOFF2 assets.
