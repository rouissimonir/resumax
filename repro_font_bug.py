"""
Standalone repro: registers the same DejaVu fonts the same way pdf_service.py
does, but prints the FULL traceback instead of swallowing it into a one-line
warning. Run with the exact interpreter that runs uvicorn:

    python repro_font_bug.py
"""
import os
import sys
import traceback

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(BASE_DIR, "backend", "static", "fonts")

_DEJAVU_VARIANTS = (
    ("", "DejaVuSans.ttf"),
    ("B", "DejaVuSans-Bold.ttf"),
    ("I", "DejaVuSans-Oblique.ttf"),
    ("BI", "DejaVuSans-BoldOblique.ttf"),
)

print("Python:", sys.version)
print("Default locale encoding:", __import__("locale").getpreferredencoding(False))
print("FONT_DIR:", FONT_DIR)

for style, filename in _DEJAVU_VARIANTS:
    path = os.path.join(FONT_DIR, filename)
    print(f"  {filename}: exists={os.path.exists(path)} size={os.path.getsize(path) if os.path.exists(path) else 'N/A'}")

from fpdf import FPDF

pdf = FPDF()
try:
    for style, filename in _DEJAVU_VARIANTS:
        print(f"Registering {filename} (style={style!r}) ...")
        pdf.add_font("DejaVu", style, os.path.join(FONT_DIR, filename))
        print("  OK")
    print("\nAll fonts registered successfully.")
except Exception:
    print("\n*** FAILURE - FULL TRACEBACK BELOW ***")
    traceback.print_exc()
