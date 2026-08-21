#!/usr/bin/env python3
"""
Normalise the raw device captures into the four screen images the layout uses.

Why the captures can't be used as-is
------------------------------------
* resume_advices.jpg opens with a white navigation band caught mid-transition
  (a ghosted "Improved Resume" title, a half-drawn "Share" pill). On the lead
  App Store image that reads as a rendering fault, so it is cropped off.
* The captures are three different heights. Forcing one aspect ratio on the
  <img> would either crop the sides of a UI screenshot or letterbox it, so they
  are padded to a common 1170x2426 with the app's own background instead —
  invisible, because every capture already ends in that colour.
* cv_template_zoomed.jpg is a 1099x547 landscape crop, not a device capture. On
  its own it left two-thirds of the phone empty, so it is composed with
  cv_template_1.jpg (the real "Preferred CV format" screen, which names
  Europass and US / Canada in actual UI).

Run:  python scripts/prep_assets.py      then      node export.js
"""
from PIL import Image
import numpy as np

BG = (10, 11, 14)      # #0A0B0E — the app canvas colour
W, H = 1170, 2426      # home.jpg's native size; every screen is padded to it


def canvas() -> Image.Image:
    return Image.new("RGB", (W, H), BG)


def fade_mask(size, top_fade: int, bottom_fade: int) -> Image.Image:
    """Alpha ramp so a pasted crop dissolves into the canvas rather than
    showing a hard horizontal seam where the source image happens to end."""
    w, h = size
    a = np.full((h, w), 255, dtype=np.uint8)
    if top_fade:
        a[:top_fade] = (np.linspace(0, 255, top_fade)[:, None]
                        * np.ones((1, w))).astype(np.uint8)
    if bottom_fade:
        a[h - bottom_fade:] = (np.linspace(255, 0, bottom_fade)[:, None]
                               * np.ones((1, w))).astype(np.uint8)
    return Image.fromarray(a, "L")


def bottom_anchored(path: str, crop_top: int = 0) -> Image.Image:
    """Pad a capture up to WxH, adding the space at the TOP so anything pinned
    to the bottom of the real screen stays pinned."""
    src = Image.open(path).convert("RGB")
    if crop_top:
        src = src.crop((0, crop_top, src.width, src.height))
    c = canvas()
    c.paste(src, (0, H - src.height))
    return c


def main() -> None:
    # Frame 1 — white navigation band is rows 0..196, cropped off. TOP-anchored
    # rather than bottom-anchored: the leftover padding lands at the bottom,
    # where it bleeds off along with the Download button at the frame's 150%
    # zoom, instead of sitting as a dead empty band across the top of the card.
    src = Image.open("resume_advices.jpg").convert("RGB").crop((0, 197, 1170, 2343))
    c = canvas(); c.paste(src, (0, 0)); c.save("f1_screen.jpg", quality=94)

    # Frame 3 — already dark at the top edge, so plain padding is seamless.
    bottom_anchored("template_example.jpg").save("f3_screen.jpg", quality=94)

    # Frame 4 — composed from two real captures.
    c = canvas()
    chips = Image.open("cv_template_1.jpg").convert("RGB")
    CH_Y = 430                                   # dark band above = room for the pills
    c.paste(chips, (0, CH_Y), fade_mask(chips.size, 100, 90))

    # Drop the "TEMPLATE / View full size" header row before zooming, so the
    # 130% scale has no words left to slice through.
    strip = Image.open("cv_template_zoomed.jpg").convert("RGB")
    strip = strip.crop((0, 100, strip.width, strip.height))
    sw = int(W * 1.30)
    sh = round(sw * strip.height / strip.width)
    strip = strip.resize((sw, sh), Image.LANCZOS)

    # LEFT-aligned, not centred: centring sliced the first card's label into
    # "arvard CV F...". Anchored at x=0 the first card is whole and the overflow
    # falls off the right edge, exactly as a scrollable row does in the app.
    c.paste(strip, (0, CH_Y + chips.height + 40), fade_mask(strip.size, 60, 0))
    c.save("f4_screen.jpg", quality=94)

    for f in ("f1_screen.jpg", "f3_screen.jpg", "f4_screen.jpg"):
        print(f, Image.open(f).size)


if __name__ == "__main__":
    main()
