# Store screenshots

`scripts/make_store_screenshots.py` turns raw device captures into
store-ready images at the exact dimensions Apple and Google require.

## 1. Capture

Install a real build on your iPhone (`eas build --profile preview`), then
capture with **Volume Up + Side button**. Screenshots come off the device at
its native resolution — the script rescales, so it does not matter which
iPhone you use.

Capture these five, named so they sort in display order:

| File | Screen |
|------|--------|
| `01-upload.png`   | Upload screen, a file selected |
| `02-formats.png`  | Template picker, options visible |
| `03-preview.png`  | Preview showing the improved CV |
| `04-download.png` | Preview with the download action |
| `05-history.png`  | History with 2–3 entries |

**Use a fake CV.** These images are public forever — do not ship your real
phone number or address. Make it realistic, though: Apple rejects listings
whose screenshots show lorem ipsum or obvious placeholder content
(guideline 2.3.3, screenshots must reflect actual app use).

Put the files in `store-assets/raw/`.

## 2. Caption

Edit `store-assets/captions.json` — keys are the raw filenames. Keep each
caption to one line if you can; two wrap fine, three crowd the device.

## 3. Build

```
pip install pillow
python scripts/make_store_screenshots.py
```

Output lands in `store-assets/out/<preset>/`.

## 4. Upload

- **App Store** — upload the `ios/` set to the 6.9" slot. Connect scales it
  down for every smaller iPhone automatically, so that one set covers the
  whole lineup. Max 10 images.
- **iPad** — only needed while `app.json` has `"supportsTablet": true`. If
  you are not actually supporting iPad, set that to `false` and skip the
  `ios_ipad/` set entirely.
- **Play Console** — upload the `android/` set. Minimum 2; use 4+ at 1080px
  or higher to stay eligible for promotional placement.

## Notes

Output is flattened to RGB on purpose. Apple rejects any screenshot carrying
an alpha channel, and Play requires 24-bit PNG — a transparent PNG fails
upload with an unhelpful error.

Re-run the script after any UI change rather than editing images by hand;
that is the entire point of it.

---

## Option B — a Figma strip export

If the screenshots are designed in Figma as one wide board (all frames side by
side), export the board as a single SVG or PNG and slice it instead:

```
pip install pillow cairosvg
python scripts/slice_store_strip.py store-assets/strip.svg
```

A 12900 x 2796 export is exactly 10 iPhone 6.9" frames; the script infers that,
splits it, and flattens each frame to RGB (Apple silently rejects any upload
with an alpha channel). Output lands in `store-assets/out/<name>/01.png` ...

Two things to know about this route:

- **Captions exported from Figma are outlined vector paths, not text.** They
  can only be edited back in Figma and re-exported — `captions.json` does not
  apply here.
- **The phone frames must already contain real captures.** App Review
  guideline 2.3.3 requires screenshots to show actual in-app content, so empty
  device shells or placeholder art will be rejected. Drop the real captures
  into the frames in Figma before exporting, especially where frames are
  rotated — those can't be composited reliably outside Figma.
