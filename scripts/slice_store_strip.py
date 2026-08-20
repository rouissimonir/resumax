#!/usr/bin/env python3
"""
Slice a wide multi-frame store-graphics strip (e.g. a Figma export) into
individual App Store / Play Store screenshots.

Why this exists
---------------
Figma exports a whole screenshot set as ONE image: 10 frames side by side is
12900 x 2796 for iPhone 6.9". The stores want ten separate 1290 x 2796 PNGs,
and Apple silently rejects anything carrying an alpha channel. This does the
split and the flatten deterministically, so a re-export is one command away
from being upload-ready.

Usage
-----
    pip install pillow cairosvg          # cairosvg only needed for .svg input

    python scripts/slice_store_strip.py store-assets/strip.svg
    python scripts/slice_store_strip.py store-assets/strip.png --frame-width 1290
    python scripts/slice_store_strip.py store-assets/strip.svg --frames 10

Input   a single wide PNG/JPG, or an SVG (rendered at its own native size,
        or at --render-width if you want to force the resolution).
Output  store-assets/out/<name>/NN.png  — one file per frame, RGB, no alpha.

Frame width is inferred: if the strip divides evenly by one of the known
store widths, that one is used. Override with --frame-width or --frames.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required.  Install it with:  pip install pillow")

Image.MAX_IMAGE_PIXELS = None  # a 12900px strip trips the decompression guard

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "store-assets" / "out"

# Frame sizes the stores actually accept, widest-first so the inference below
# prefers the largest plausible split rather than a coincidental small one.
KNOWN_FRAME_SIZES = [
    (2064, 2752, 'iPad 13"'),
    (1320, 2868, 'iPhone 6.9" (1320)'),
    (1290, 2796, 'iPhone 6.9"'),
    (1284, 2778, 'iPhone 6.5"'),
    (1260, 2736, 'iPhone 6.9" (1260)'),
    (1080, 1920, "Android phone"),
]


def render_svg(path: Path, render_width: int | None) -> Image.Image:
    try:
        import cairosvg
    except ImportError:
        sys.exit(
            "SVG input needs cairosvg.  Install it with:  pip install cairosvg\n"
            "(or export the strip from Figma as PNG and pass that instead)"
        )
    import io

    kwargs = {"url": str(path)}
    if render_width:
        kwargs["output_width"] = render_width
    png_bytes = cairosvg.svg2png(**kwargs)
    return Image.open(io.BytesIO(png_bytes))


def infer_frame_width(width: int, height: int) -> tuple[int, str]:
    """Pick the frame width that divides the strip evenly and matches height."""
    for fw, fh, label in KNOWN_FRAME_SIZES:
        if width % fw == 0 and height == fh:
            return fw, label
    # Height didn't match a known preset — fall back to width alone.
    for fw, _fh, label in KNOWN_FRAME_SIZES:
        if width % fw == 0:
            return fw, f"{label} width (height {height} is non-standard)"
    sys.exit(
        f"Can't infer the frame width for a {width}x{height} strip.\n"
        f"Pass --frames N or --frame-width W explicitly."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("strip", type=Path, help="Wide PNG/JPG/SVG containing all frames.")
    ap.add_argument("--frames", type=int, help="Number of frames in the strip.")
    ap.add_argument("--frame-width", type=int, help="Width of one frame in px.")
    ap.add_argument("--render-width", type=int,
                    help="For SVG input: force the render width (default: native).")
    ap.add_argument("--out-name", help="Output subfolder name (default: strip stem).")
    args = ap.parse_args()

    if not args.strip.exists():
        sys.exit(f"No such file: {args.strip}")

    if args.strip.suffix.lower() == ".svg":
        img = render_svg(args.strip, args.render_width)
    else:
        img = Image.open(args.strip)

    w, h = img.size
    print(f"Strip: {w} x {h}")

    if args.frame_width:
        frame_w, label = args.frame_width, "explicit --frame-width"
    elif args.frames:
        if w % args.frames:
            sys.exit(f"{w}px doesn't divide evenly into {args.frames} frames.")
        frame_w, label = w // args.frames, "explicit --frames"
    else:
        frame_w, label = infer_frame_width(w, h)

    if w % frame_w:
        sys.exit(f"{w}px doesn't divide evenly by a {frame_w}px frame.")

    count = w // frame_w
    print(f"Splitting into {count} x {frame_w} x {h}  ({label})")

    if count > 10:
        print(f"  ! Apple accepts at most 10 screenshots per size; you have {count}.")

    out = OUT_DIR / (args.out_name or args.strip.stem)
    out.mkdir(parents=True, exist_ok=True)

    for i in range(count):
        frame = img.crop((i * frame_w, 0, (i + 1) * frame_w, h))
        # Apple rejects any upload with an alpha channel, and Play requires
        # 24-bit PNG. Flatten onto white so transparent corners don't go black.
        if frame.mode in ("RGBA", "LA", "P"):
            frame = frame.convert("RGBA")
            flat = Image.new("RGB", frame.size, (255, 255, 255))
            flat.paste(frame, mask=frame.split()[-1])
            frame = flat
        else:
            frame = frame.convert("RGB")
        dest = out / f"{i + 1:02d}.png"
        frame.save(dest, "PNG", optimize=True)
        print(f"  {dest.relative_to(ROOT)}")

    print(f"\nDone. {count} frame(s) in {out.relative_to(ROOT)} — RGB, no alpha.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
