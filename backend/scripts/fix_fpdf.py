"""
Replace fpdf2-only new_x/new_y kwargs with fpdf 1.x equivalents.
Run from backend/:  python scripts/fix_fpdf.py
"""
import re, os, sys

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "services", "pdf_service.py")
path = os.path.normpath(path)

with open(path, encoding="utf-8") as f:
    src = f.read()

original = src

# ── cell() calls: new_x="LMARGIN", new_y="NEXT" → ln=True ───────────────────
# These appear as trailing kwargs (sometimes with leading comma+space/newline)
src = re.sub(
    r',\s*new_x=["\']LMARGIN["\'],\s*new_y=["\']NEXT["\']',
    ', ln=True',
    src,
)

# ── multi_cell() calls: new_x/new_y are the default in fpdf1 → just remove ───
# The pattern above would have already caught these too, converting them to
# ', ln=True' which is not a valid multi_cell kwarg in fpdf1.
# We need to undo that for multi_cell: remove ', ln=True' when it follows
# a multi_cell argument list.
# Strategy: replace 'self.multi_cell(..., ln=True)' → 'self.multi_cell(...)'
# Use a simple string approach since the patterns are consistent.
src = re.sub(
    r'(self\.multi_cell\([^)]*?),\s*ln=True',
    r'\1',
    src,
    flags=re.DOTALL,
)

if src == original:
    print("Nothing changed — already clean.")
else:
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    changed = src.count("new_x") + src.count("new_y")
    print(f"Fixed. Remaining new_x/new_y occurrences: {changed}")
