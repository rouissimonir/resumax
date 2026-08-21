# App Store screenshot frames

`resumax-store-screenshots.html` renders the four App Store cards side by side.
Open it in a browser to edit copy, colours or layout; it needs the four
`*_screen.jpg` / `home.jpg` files sitting beside it.

`resumax-store-screenshots.standalone.html` is the same page with Tailwind, the
Inter webfont and all four images inlined. No network, no loose files — good for
sending someone a preview.

## Rebuilding the PNGs

```
npm i -D tailwindcss@3.4.17 @fontsource/inter playwright
pip install pillow numpy
python prep_assets.py     # raw captures -> normalised screen images
node export.js            # -> out/*.png at exactly 1290x2796
```

`export.js` swaps the Tailwind CDN and Google Fonts for the locally compiled
`tw.css` and an embedded Inter before rendering, so an export never depends on
the network being up.

## Two things that are easy to get wrong

**Capture the viewport, not the element.** Each card is authored at 430 x 932 CSS
px — exactly one third of 1290 x 2796 — and rendered at `deviceScaleFactor: 3`.
An *element* screenshot inherits the card's fractional x-offset from the centred
grid, and 430 CSS px straddling a half-pixel boundary rasterises to **1293** px,
which App Store Connect rejects. `export.js` sizes the viewport to one card and
lifts that card to the origin so the output size is exact by construction.

**No alpha channel.** Apple silently rejects any upload carrying one, and Play
requires 24-bit PNG. The frames render on an opaque background so the output is
already RGB — but re-check after any edit that introduces transparency.

## What was changed from the raw captures

- `resume_advices.jpg` opened with a white navigation band caught mid-transition
  (ghosted "Improved Resume" title, half-drawn "Share" pill). Cropped off; the
  height is added back at the top so "Download PDF" stays pinned to the bottom.
- All screens are padded to a common 1170 x 2426 so one phone size serves the
  set. Padding uses the app's own background, which every capture already ends
  in, so the joins are invisible. Nothing is cropped from the sides.
- Frame 4 composes two real captures. `cv_template_zoomed.jpg` alone left the
  upper two-thirds of the phone empty and its 130% zoom sliced "TEMPLATE" into
  "MPLATE". It is now paired with `cv_template_1.jpg` — the real "Preferred CV
  format" screen, which names Europass (EU) and US / Canada Resume in actual UI.
  The carousel strip is left-aligned rather than centred so the first card's
  label reads "Harvard CV F..." (the app's own truncation) instead of "arvard".

Everything inside the device frames is a real capture. Only the captions, the
glows and the two glass pills are added — which is what guideline 2.3.3 requires.

## Still to do

Apple takes up to 10 screenshots per size and shows the first 2-3 in search
results. Four is a workable minimum; if you add more, put the strongest proof
first — right now that is the 94% ATS score.
