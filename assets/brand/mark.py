"""
Resumax mark — a rising "M" whose final upstroke continues into an arrow.

Drawn from geometry rather than traced, so every size is a clean re-render
rather than a resample. Proportions are defined once here; every asset (app
icon, adaptive foreground, monochrome, favicon, wordmark) is generated from it.

Design constraints, taken from constants/theme.ts:
  · Flat fill. No gradient, glow or drop shadow — the theme says structure
    comes from borders and background layers, not from effects.
  · One colour. `primary` #18181B on light, #FAFAFA on dark. No second brand
    colour, because the theme reserves colour for meaning (success/error).

The glyph is laid out in arbitrary units and then *analytically fitted* to the
canvas: the bounding box is computed from the geometry (including stroke half
-width and the arrowhead), and a single transform scales and centres it. This
is why nothing clips at any size — the fit is derived, never eyeballed.
"""

import math

VIEW = 100.0

# ── Proportions ──────────────────────────────────────────────────────────
STROKE = 12.0          # stem thickness
LEFT = 0.0
RIGHT = 60.0
TOP = 0.0              # cap height (y grows downward)
BOTTOM = 46.0          # baseline
VALLEY_FRAC = 0.60     # middle vertex, as a fraction from TOP to BOTTOM.
                       # Above the baseline so the centre lifts and the whole
                       # form reads as rising rather than as a plain letter.
LEAN = 0.06            # slight inward lean on the peaks
ARROW_LEN = 30.0       # how far past the peak the tip sits
# The head is a stroked chevron, not a filled triangle. A triangle has to be
# boolean-unioned with the shaft to look like one object; drawn as separate
# geometry it reads as a notched flag wherever the two overlap. A chevron uses
# the same stroke weight and round caps as the M, so the whole mark is one
# consistent pen.
HEAD_LEN = 21.0        # length of each barb
HEAD_ANGLE = 42.0      # degrees off the shaft axis

MID = (LEFT + RIGHT) / 2.0
VALLEY = TOP + (BOTTOM - TOP) * VALLEY_FRAC


def _m_points():
    return [
        (LEFT, BOTTOM),
        (LEFT + (MID - LEFT) * LEAN, TOP),
        (MID, VALLEY),
        (RIGHT - (RIGHT - MID) * LEAN, TOP),
        (RIGHT, BOTTOM),
    ]


def _arrow_geometry():
    """Shaft continues the direction of the M's final upstroke."""
    x0, y0 = MID, VALLEY
    x1, y1 = RIGHT - (RIGHT - MID) * LEAN, TOP
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    tip = (x1 + ux * ARROW_LEN, y1 + uy * ARROW_LEN)
    return (x1, y1), tip, (ux, uy)


def _head_points():
    """The two barb endpoints, swept back from the tip at ±HEAD_ANGLE."""
    _, (tx, ty), (ux, uy) = _arrow_geometry()
    out = []
    for sign in (1.0, -1.0):
        a = math.radians(HEAD_ANGLE) * sign
        # Rotate the reversed shaft direction by ±HEAD_ANGLE.
        rx = -ux * math.cos(a) + uy * math.sin(a)
        ry = -ux * math.sin(a) - uy * math.cos(a)
        out.append((tx + rx * HEAD_LEN, ty + ry * HEAD_LEN))
    return out


def _bbox():
    """
    Bounding box of the drawn artwork, including the stroke's half-width.

    Round caps and joins mean every stroked vertex extends STROKE/2 in all
    directions, so padding the polyline extents by that is exact rather than
    approximate.
    """
    half = STROKE / 2.0
    xs, ys = [], []
    for x, y in _m_points():
        xs += [x - half, x + half]
        ys += [y - half, y + half]
    (sx, sy), (tx, ty), _ = _arrow_geometry()
    for x, y in ((sx, sy), (tx, ty)):
        xs += [x - half, x + half]
        ys += [y - half, y + half]
    for x, y in _head_points():
        xs += [x - half, x + half]
        ys += [y - half, y + half]
    return min(xs), min(ys), max(xs), max(ys)


def _fit_transform(margin_frac):
    """Scale + translate that centres the artwork in VIEW with a margin."""
    x0, y0, x1, y1 = _bbox()
    w, h = x1 - x0, y1 - y0
    avail = VIEW * (1.0 - margin_frac * 2)
    scale = avail / max(w, h)
    tx = (VIEW - w * scale) / 2.0 - x0 * scale
    ty = (VIEW - h * scale) / 2.0 - y0 * scale
    return f"translate({tx:.4f} {ty:.4f}) scale({scale:.5f})"


def _paths(fg):
    """
    Three strokes, one pen: the M, the shaft continuing its final upstroke,
    and the chevron head. All share STROKE and round caps, so overlaps merge
    invisibly instead of producing seams.
    """
    pts = _m_points()
    d = f"M {pts[0][0]:.2f} {pts[0][1]:.2f}" + "".join(
        f" L {x:.2f} {y:.2f}" for x, y in pts[1:]
    )
    (sx, sy), (tx, ty), _ = _arrow_geometry()
    (h1x, h1y), (h2x, h2y) = _head_points()
    common = (f'fill="none" stroke="{fg}" stroke-width="{STROKE}" '
              f'stroke-linecap="round" stroke-linejoin="round"')
    return (
        f'<path d="{d}" {common}/>'
        f'<path d="M {sx:.2f} {sy:.2f} L {tx:.2f} {ty:.2f}" {common}/>'
        f'<path d="M {h1x:.2f} {h1y:.2f} L {tx:.2f} {ty:.2f} '
        f'L {h2x:.2f} {h2y:.2f}" {common}/>'
    )


def mark_svg(fg="#18181B", bg=None, size=1024, margin=0.06):
    """The bare mark. `margin` is the inset as a fraction of the canvas."""
    background = f'<rect width="{VIEW}" height="{VIEW}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {VIEW} {VIEW}">{background}'
        f'<g transform="{_fit_transform(margin)}">{_paths(fg)}</g></svg>'
    )


def icon_svg(fg="#FAFAFA", bg="#18181B", size=1024, radius=None, margin=0.20):
    """
    The app icon: glyph knocked out of a filled square.

    radius=None exports a full-bleed square, which is what iOS and Expo want —
    iOS applies its own mask, and a pre-rounded PNG with transparent corners
    gets double-rounded and reads as visibly inset. Pass a radius only for
    previews.
    """
    shape = (
        f'<rect width="{VIEW}" height="{VIEW}" rx="{radius}" ry="{radius}" fill="{bg}"/>'
        if radius else f'<rect width="{VIEW}" height="{VIEW}" fill="{bg}"/>'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {VIEW} {VIEW}">{shape}'
        f'<g transform="{_fit_transform(margin)}">{_paths(fg)}</g></svg>'
    )


def adaptive_foreground_svg(fg="#FAFAFA", size=1024):
    """
    Android adaptive icon foreground: transparent, and heavily inset.

    The launcher masks this layer to a shape of its choosing and may also
    parallax it, keeping only the central ~66%. A glyph sized for the iOS icon
    loses its arrowhead here, so the margin is much larger.
    """
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {VIEW} {VIEW}">'
        f'<g transform="{_fit_transform(0.30)}">{_paths(fg)}</g></svg>'
    )


def wordmark_svg(fg="#18181B", muted="#3F3F46", width=1600, bg=None):
    """
    Mark + "Resumax" lockup.

    Type is set in the same weight/tracking the app's Typography.h1 uses
    (700, -0.7 tracking) so the wordmark and an on-screen title look related.
    """
    h = 100.0
    w = 342.0            # trimmed to the type's right edge — a wide
                         # canvas becomes invisible padding at every use site
    glyph_box = 88.0
    scale = glyph_box / VIEW
    tf = _fit_transform(0.02)
    background = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{int(width * h / w)}" viewBox="0 0 {w} {h}">{background}'
        f'<g transform="translate(6 6) scale({scale:.5f})">'
        f'<g transform="{tf}">{_paths(fg)}</g></g>'
        f'<text x="108" y="63" font-family="DejaVu Sans" '
        f'font-size="46" font-weight="700" letter-spacing="-1.4" fill="{fg}">Resumax</text>'
        f'</svg>'
    )
