#!/usr/bin/env python3
"""
Turn raw phone screenshots into store-ready App Store / Play Store images.

Why this exists
---------------
Both stores demand exact pixel dimensions, and Apple silently rejects any
upload carrying an alpha channel. Doing that by hand in an image editor is
error-prone and has to be redone every release. This script is deterministic:
drop new captures in, re-run, ship.

Usage
-----
    pip install pillow
    python scripts/make_store_screenshots.py

    # only rebuild one platform
    python scripts/make_store_screenshots.py --only ios

Input   store-assets/raw/*.png|jpg   (captures straight off the device,
                                      sorted by filename -> display order)
Config  store-assets/captions.json   (filename -> caption text; optional)
Output  store-assets/out/<preset>/NN_<name>.png

Captures do NOT need to match the output size. Anything with a roughly
phone-shaped aspect ratio is scaled to fit the device slot.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit("Pillow is required.  Install it with:  pip install pillow")


# ── Paths ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "store-assets" / "raw"
OUT_DIR = ROOT / "store-assets" / "out"
CAPTIONS_FILE = ROOT / "store-assets" / "captions.json"


# ── Output presets ───────────────────────────────────────────────────────────
#
# iOS: 6.9" is the only size worth producing. App Store Connect scales a
# supplied size DOWN to every smaller iPhone automatically, so one set covers
# the whole lineup. iPad is only required while app.json has
# "supportsTablet": true — set that to false and you can delete the preset.
#
# Android: Play wants 16:9 / 9:16 and at least 1080px for promo eligibility.

PRESETS = {
    "ios":         {"size": (1290, 2796), "label": 'iPhone 6.9"'},
    "ios_ipad":    {"size": (2064, 2752), "label": 'iPad 13"'},
    "android":     {"size": (1080, 1920), "label": "Android phone"},
}

# Brand palette — matches the app's own dark gradient (see LoginScreen).
BG_TOP = (26, 32, 44)        # #1A202C
BG_BOTTOM = (49, 46, 129)    # #312E81 — indigo, dark enough that white caption text
                             # stays legible at the bottom of the frame too.
TEXT_COLOR = (247, 250, 252)
SUBTEXT_COLOR = (160, 174, 192)


# ── Font loading ─────────────────────────────────────────────────────────────

FONT_CANDIDATES = {
    "bold": [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ],
    "regular": [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ],
}


def load_font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """First font that exists wins. Falls back to Pillow's bitmap default."""
    for path in FONT_CANDIDATES[weight]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    print(f"  ! No TrueType font found for '{weight}' — captions will look rough.")
    return ImageFont.load_default()


# ── Drawing helpers ──────────────────────────────────────────────────────────

def gradient_background(size: tuple[int, int]) -> Image.Image:
    """Vertical two-stop gradient, built one row at a time then stretched."""
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = tuple(
            round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
        )
    return strip.resize(size, Image.Resampling.LANCZOS)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (size[0] - 1, size[1] - 1)],
                                           radius=radius, fill=255)
    return mask


def fit_within(img: Image.Image, box: tuple[int, int]) -> Image.Image:
    """Scale to fit inside `box` preserving aspect ratio (never crops)."""
    bw, bh = box
    scale = min(bw / img.width, bh / img.height)
    return img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
        Image.Resampling.LANCZOS,
    )


def wrap(draw, text: str, font, max_width: int) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def compose(shot: Image.Image, caption: str, preset: dict) -> Image.Image:
    w, h = preset["size"]
    canvas = gradient_background((w, h))

    margin = round(w * 0.07)
    caption_font = load_font("bold", round(w * 0.052))
    draw = ImageDraw.Draw(canvas)

    # Caption block sits above the device. Height is measured, not assumed,
    # so a two-line caption doesn't overlap the screenshot.
    lines = wrap(draw, caption, caption_font, w - margin * 2) if caption else []
    line_h = round(w * 0.052 * 1.35)
    caption_h = len(lines) * line_h
    top_pad = round(h * 0.055)

    y = top_pad
    for line in lines:
        tw = draw.textlength(line, font=caption_font)
        draw.text(((w - tw) / 2, y), line, font=caption_font, fill=TEXT_COLOR)
        y += line_h

    # Device slot: whatever vertical space the caption left over.
    slot_top = top_pad + caption_h + (round(h * 0.035) if lines else 0)
    slot_h = h - slot_top - round(h * 0.045)
    slot_w = w - margin * 2

    device = fit_within(shot, (slot_w, slot_h))
    radius = round(device.width * 0.075)
    mask = rounded_mask(device.size, radius)

    dx = (w - device.width) // 2
    dy = slot_top + (slot_h - device.height) // 2

    # Soft drop shadow so the screenshot reads as a physical object rather
    # than a rectangle pasted onto a gradient.
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [(dx, dy + round(h * 0.006)),
         (dx + device.width, dy + device.height + round(h * 0.006))],
        radius=radius, fill=(0, 0, 0, 120),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(w * 0.018)))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)

    canvas.paste(device.convert("RGB"), (dx, dy), mask)

    # Flatten to RGB. Apple rejects any upload with an alpha channel, and Play
    # requires 24-bit PNG — this is the line that keeps both happy.
    return canvas.convert("RGB")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=sorted(PRESETS), action="append",
                        help="Build just this preset (repeatable).")
    args = parser.parse_args()

    presets = {k: v for k, v in PRESETS.items()
               if not args.only or k in args.only}

    if not RAW_DIR.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print(f"Created {RAW_DIR.relative_to(ROOT)} — put your captures there "
              f"and re-run.")
        return 1

    shots = sorted(
        p for p in RAW_DIR.iterdir()
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )
    if not shots:
        print(f"No images in {RAW_DIR.relative_to(ROOT)}.")
        return 1

    captions = {}
    if CAPTIONS_FILE.exists():
        captions = json.loads(CAPTIONS_FILE.read_text(encoding="utf-8"))

    missing = [s.name for s in shots if s.name not in captions]
    if missing:
        print(f"  ! No caption for: {', '.join(missing)} (rendering bare)")

    for preset_name, preset in presets.items():
        out = OUT_DIR / preset_name
        out.mkdir(parents=True, exist_ok=True)
        print(f"\n{preset['label']}  {preset['size'][0]}x{preset['size'][1]}")

        for i, path in enumerate(shots, start=1):
            with Image.open(path) as src:
                result = compose(src.convert("RGB"),
                                 captions.get(path.name, ""), preset)
            dest = out / f"{i:02d}_{path.stem}.png"
            result.save(dest, "PNG", optimize=True)
            print(f"  {dest.relative_to(ROOT)}")

    print(f"\nDone. {len(shots)} screenshot(s) x {len(presets)} preset(s).")
    print("Apple takes max 10 per size; Play needs at least 2 (4+ recommended).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
