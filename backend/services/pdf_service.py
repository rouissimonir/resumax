import cv2
import numpy as np
from paddleocr import PaddleOCR
from pdf2image import convert_from_path
import pytesseract
import PyPDF2
from PIL import Image
import logging
import os
import re
import unicodedata

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# LATEX / OT1 ACCENT REPAIR
# ─────────────────────────────────────────────────────────────
#
# A CV typeset in LaTeX with the classic OT1 (Computer Modern) encoding does
# not contain an "é" glyph at all. It draws an acute accent glyph and an "e"
# glyph at overlapping positions. Every text extractor — PyPDF2, pypdf,
# pdfplumber, PyMuPDF — therefore yields two characters, because two characters
# are genuinely what is in the file:
#
#     "Développeur"  ->  "D´eveloppeur"
#     "systèmes"     ->  "syst`emes"
#     "Conçu"        ->  "Conc¸u"
#     "tâches"       ->  "t^aches"
#
# No extractor choice fixes this; it has to be repaired after the fact by
# recombining the loose accent with its base letter. Accents render BEFORE
# their base letter (´ + e), except cedilla and ogonek which render AFTER
# (c + ¸), because that is the order LaTeX emits them.

_PREFIX_ACCENTS = {
    "´": "́",  # ´  acute
    "ˊ": "́",  # ˊ  modifier acute
    "`": "̀",  # `  grave
    "ˋ": "̀",  # ˋ  modifier grave
    "^": "̂",  # ^  circumflex
    "ˆ": "̂",  # ˆ  modifier circumflex
    "~": "̃",  # ~  tilde
    "˜": "̃",  # ˜  small tilde
    "¨": "̈",  # ¨  diaeresis
    "ˇ": "̌",  # ˇ  caron
    "˘": "̆",  # ˘  breve
    "˚": "̊",  # ˚  ring above
    "¯": "̄",  # ¯  macron
    "ˉ": "̄",  # ˉ  modifier macron
    "˝": "̋",  # ˝  double acute
    "˙": "̇",  # ˙  dot above
}

_SUFFIX_ACCENTS = {
    "¸": "̧",  # ¸  cedilla
    "˛": "̨",  # ˛  ogonek
}

# "´", "¸", "ˆ" and friends effectively never occur in ordinary CV prose, so
# finding them is itself the signal that this is a LaTeX extraction. "`", "^"
# and "~" DO occur in ordinary text (shell snippets, `code spans`, "x^2"), so
# they are only treated as accents once the unambiguous ones have proved what
# kind of document this is.
_UNAMBIGUOUS_ACCENTS = "´ˊˋˆ˜¨ˇ˘˚¯ˉ˝˙¸˛"
_ASCII_ACCENTS = "`^~"

_LATEX_EVIDENCE_RE = re.compile(
    "[" + _UNAMBIGUOUS_ACCENTS + "][ \t]*[A-Za-z]"
    "|[A-Za-z][ \t]*[" + "".join(_SUFFIX_ACCENTS) + "]"
)
_LATEX_EVIDENCE_THRESHOLD = 3


def _prefix_re(accents: str) -> "re.Pattern":
    return re.compile("([" + accents + r"])[ \t]*([A-Za-z])")


_SUFFIX_RE = re.compile(r"([A-Za-z])[ \t]*([" + "".join(_SUFFIX_ACCENTS) + "])")


def _combine(base: str, mark: str, original: str) -> str:
    """Compose base+mark, or return the original text if they do not compose."""
    combined = unicodedata.normalize("NFC", base + mark)
    return combined if len(combined) == 1 else original


def repair_latex_accents(text: str) -> str:
    """
    Recombine LaTeX/OT1 floating accents with their base letters.

    Deliberately does NOT touch whitespace. LaTeX extraction also scatters word
    boundaries ("impl ´ement ´edes"), but whether a given space is a real word
    break or a glyph-positioning artefact is genuinely ambiguous from the text
    alone — "exp ´erience" is one word, "architecture ´ev ´enementielle" is two,
    and they are the same shape. Guessing would merge real words. Fixing the
    accents is deterministic and is done here; fixing the spacing needs language
    knowledge and is left to the AI pass, which is instructed to do it.

    Safe on text that does not need it: a substitution is kept only if the
    accent and base actually compose into one precomposed codepoint.
    """
    if not text:
        return text

    evidence = len(_LATEX_EVIDENCE_RE.findall(text))
    if evidence < _LATEX_EVIDENCE_THRESHOLD:
        return text

    repaired = _SUFFIX_RE.sub(
        lambda m: _combine(m.group(1), _SUFFIX_ACCENTS[m.group(2)], m.group(0)),
        text,
    )
    repaired = _prefix_re(_UNAMBIGUOUS_ACCENTS + _ASCII_ACCENTS).sub(
        lambda m: _combine(m.group(2), _PREFIX_ACCENTS[m.group(1)], m.group(0)),
        repaired,
    )

    if repaired != text:
        logger.info(
            "Repaired %d LaTeX-style floating accents in extracted text "
            "(source PDF appears to be LaTeX/OT1 encoded).", evidence,
        )
    return repaired

_ocr_instance = None

def get_paddle_ocr():
    """Initialize PaddleOCR instance (singleton pattern)."""
    global _ocr_instance
    if _ocr_instance is None:
        logger.info("Initializing PaddleOCR...")
        try:
            # Use minimal parameters for maximum compatibility
            _ocr_instance = PaddleOCR(lang='en')
            logger.info("PaddleOCR initialized successfully")
        except Exception as e:
            logger.error(f"PaddleOCR initialization failed: {str(e)}")
            raise
    return _ocr_instance

def extract_text_with_paddle_ocr(pdf_path: str) -> tuple[str, bool]:
    """
    Extract text using PaddleOCR with resume-specific optimizations.
    Handles images, tables, multiple columns, and complex layouts.
    Returns: (extracted_text, success)
    """
    try:
        logger.info("Attempting text extraction with PaddleOCR (Resume-optimized)...")
        
        # Convert PDF to images - use 200 DPI for balance of speed vs quality 
        # (300 DPI is overkill and 3x slower)
        images = convert_from_path(pdf_path, dpi=200)
        logger.info(f"Converted PDF to {len(images)} images at 200 DPI")
        
        ocr = get_paddle_ocr()
        all_text = []
        
        for i, image in enumerate(images):
            # Convert PIL image to numpy array (use RGB directly, no preprocessing)
            # PaddleOCR works best with clean color images
            img_array = np.array(image)
            
            # Try original image first (works better for clean PDFs)
            logger.info(f"Page {i+1}: Processing with original image...")
            try:
                result = ocr.ocr(img_array)
            except Exception as ocr_error:
                logger.warning(f"Page {i+1}: OCR error on original image: {str(ocr_error)}")
                result = None
            
            # If result is poor, try with grayscale image (simpler preprocessing, still fast)
            if not result or not result[0] or len(result[0]) < 5:
                logger.info(f"Page {i+1}: Retrying with grayscale image...")
                try:
                    # Simple grayscale conversion as fallback
                    if len(img_array.shape) == 3:
                        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
                        # Convert back to 3 channels for PaddleOCR
                        gray_3ch = cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
                        result = ocr.ocr(gray_3ch)
                    else:
                        result = ocr.ocr(img_array)
                except Exception as ocr_error:
                    logger.warning(f"Page {i+1}: OCR error on grayscale image: {str(ocr_error)}")
                    result = None
            
            if result and result[0]:
                page_text = []
                
                # Debug: Log the raw result structure to understand the format
                if result[0] and len(result[0]) > 0:
                    sample = result[0][0]
                    logger.info(f"Page {i+1}: OCR result sample structure: {type(sample)}, len={len(sample) if hasattr(sample, '__len__') else 'N/A'}")
                    if len(result[0]) > 0:
                        logger.info(f"Page {i+1}: Sample item: {str(sample)[:200]}")
                
                # Sort by vertical position (top to bottom) then horizontal (left to right)
                # This helps maintain proper reading order in multi-column resumes
                try:
                    sorted_lines = sorted(result[0], key=lambda x: (x[0][0][1], x[0][0][0]))
                except (IndexError, TypeError) as sort_error:
                    logger.warning(f"Page {i+1}: Could not sort lines, using original order: {sort_error}")
                    sorted_lines = result[0]
                
                for line in sorted_lines:
                    try:
                        # Handle different PaddleOCR result formats defensively
                        # Format can be: [[box], (text, confidence)] or [[box], [text, confidence]]
                        if not line or len(line) < 2:
                            continue
                        
                        text_data = line[1]
                        if isinstance(text_data, (list, tuple)) and len(text_data) >= 2:
                            text = str(text_data[0]).strip() if text_data[0] else ""
                            confidence = float(text_data[1]) if text_data[1] else 0.0
                        elif isinstance(text_data, str):
                            text = text_data.strip()
                            confidence = 1.0  # Assume high confidence if not provided
                        else:
                            continue
                        
                        # Only include text with reasonable confidence (>0.5)
                        if text and confidence > 0.5:
                            page_text.append(text)
                        elif text:
                            logger.debug(f"Skipped low-confidence text: {text} (confidence: {confidence:.2f})")
                    except (IndexError, TypeError, ValueError) as line_error:
                        logger.debug(f"Page {i+1}: Skipped malformed line: {line_error}")
                
                # Check if we're getting single characters (PaddleOCR character-level output)
                # If so, try to group them into words based on horizontal proximity
                if page_text and all(len(t) <= 2 for t in page_text[:20]):
                    logger.warning(f"Page {i+1}: Detected character-level output, grouping into words...")
                    # Join consecutive single characters (this is a fallback)
                    grouped_text = ' '.join(page_text)
                    page_text = [grouped_text]
                    logger.info(f"Page {i+1}: Grouped text sample: {grouped_text[:100]}")
                
                page_content = '\n'.join(page_text)
                all_text.append(page_content)
                logger.info(f"Page {i+1}: Extracted {len(page_content)} characters ({len(page_text)} lines)")
            else:
                logger.warning(f"Page {i+1}: No text detected")
        
        extracted = '\n\n'.join(all_text)
        logger.info(f"PaddleOCR extraction complete. Total: {len(extracted)} characters")
        
        # Final check: warn if extraction seems poor
        if len(extracted) < 100:
            logger.warning(f"⚠️ OCR extracted very little content ({len(extracted)} chars). This PDF may need special handling.")
        
        return extracted, True
        
    except Exception as e:
        logger.warning(f"PaddleOCR failed: {str(e)}")
        return "", False

def extract_text_with_tesseract(pdf_path: str) -> tuple[str, bool]:
    """
    Extract text using Tesseract OCR.
    Returns: (extracted_text, success)
    """
    try:
        logger.info("Attempting text extraction with Tesseract OCR...")
        images = convert_from_path(pdf_path)
        logger.info(f"Converted PDF to {len(images)} images")
        
        all_text = []
        
        for i, image in enumerate(images):
            # Use pytesseract to extract text
            text = pytesseract.image_to_string(image, lang='eng')
            all_text.append(text)
            logger.info(f"Page {i+1}: Extracted {len(text)} characters")
        
        extracted = '\n\n'.join(all_text)
        logger.info(f"Tesseract extraction complete. Total: {len(extracted)} characters")
        return extracted, True
        
    except Exception as e:
        logger.warning(f"Tesseract failed: {str(e)}")
        return "", False

def extract_text_with_pypdf2(pdf_path: str) -> tuple[str, bool]:
    """
    Extract text using PyPDF2 (direct text extraction, no OCR).
    Returns: (extracted_text, success)
    """
    try:
        logger.info("Attempting text extraction with PyPDF2...")
        text = ""
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            num_pages = len(reader.pages)
            logger.info(f"PDF has {num_pages} pages")
            
            for i, page in enumerate(reader.pages):
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
                logger.debug(f"Extracted {len(extracted) if extracted else 0} chars from page {i+1}")
        
        logger.info(f"PyPDF2 extraction complete. Total: {len(text)} characters")
        return text.strip(), True
        
    except Exception as e:
        logger.warning(f"PyPDF2 failed: {str(e)}")
        return "", False

def extract_text_from_pdf(pdf_path: str) -> str:
    """
    Extract text from PDF using multiple OCR methods with fallback.
    Priority: PaddleOCR -> Tesseract -> PyPDF2
    """
    try:
        logger.info(f"Starting text extraction from PDF: {pdf_path}")
        logger.info("=" * 80)
        
        ocr_method_used = "None"
        extracted_text = ""
        
        # Try PyPDF2 FIRST (fast for digital PDFs - most common case)
        logger.info("PRIMARY METHOD: Attempting PyPDF2 (fast for digital PDFs)...")
        text, success = extract_text_with_pypdf2(pdf_path)
        if success and text.strip():
            ocr_method_used = "PyPDF2 (Direct Text Extraction)"
            extracted_text = text
            logger.info("✓ PyPDF2 succeeded! (Fast extraction)")
        else:
            logger.warning("✗ PyPDF2 failed or returned empty text")
            logger.info("   This might be a scanned PDF, trying OCR methods...")
            
            # Try PaddleOCR FIRST for scanned PDFs (better quality)
            logger.info("BACKUP METHOD: Attempting PaddleOCR (High Quality)...")
            text, success = extract_text_with_paddle_ocr(pdf_path)
            if success and text.strip():
                ocr_method_used = "PaddleOCR"
                extracted_text = text
                logger.info("✓ PaddleOCR succeeded!")
            else:
                logger.warning("✗ PaddleOCR failed or returned empty text")
                
                # Try Tesseract as final fallback
                logger.info("FALLBACK METHOD: Attempting Tesseract OCR...")
                text, success = extract_text_with_tesseract(pdf_path)
                if success and text.strip():
                    ocr_method_used = "Tesseract OCR"
                    extracted_text = text
                    logger.info("✓ Tesseract OCR succeeded!")
                else:
                    logger.error("✗ All extraction methods failed!")
                    raise Exception("All OCR methods failed to extract text")
        
        logger.info("=" * 80)

        # A LaTeX-typeset source CV yields "D´eveloppeur" rather than
        # "Développeur". Repair before the text ever reaches the AI, otherwise
        # the model faithfully copies the mangled accents into its output and
        # every downstream renderer draws them exactly as received.
        extracted_text = repair_latex_accents(extracted_text)

        # Calculate number of pages
        if ocr_method_used == 'PyPDF2 (Direct Text Extraction)':
            with open(pdf_path, 'rb') as pdf_file:
                reader = PyPDF2.PdfReader(pdf_file)
                num_pages = len(reader.pages)
        else:
            # For OCR methods, we already know the page count from convert_from_path
            num_pages = "Already processed via image conversion"
        
        # Save extracted text to file
        ocr_output_path = pdf_path.replace('_original.pdf', '_ocr_result.txt')
        with open(ocr_output_path, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("OCR EXTRACTION RESULT\n")
            f.write(f"Method: {ocr_method_used}\n")
            f.write(f"Source: {pdf_path}\n")
            f.write(f"Total Characters: {len(extracted_text)}\n")
            f.write(f"Number of Pages: {num_pages}\n")
            f.write("=" * 80 + "\n\n")
            f.write(extracted_text)
        logger.info(f"OCR results saved to: {ocr_output_path}")
        
        return extracted_text.strip()
    except Exception as e:
        logger.error(f"Error extracting text from PDF: {str(e)}", exc_info=True)
        raise Exception(f"Error extracting text from PDF: {str(e)}")

import copy
from fpdf import FPDF
from fpdf.enums import XPos, YPos

from services.templates import get_template


# ─────────────────────────────────────────────────────────────
# UNICODE SUPPORT
# ─────────────────────────────────────────────────────────────
#
# The six legacy renderers use FPDF *core* fonts, which are WinAnsi-encoded.
# Their sanitize() ends in `.encode('cp1252', 'replace')`, which silently
# destroys Polish, Czech, Hungarian, Romanian, Turkish, Greek and Cyrillic.
# That is invisible today, but unacceptable for anything branded "Europass".
#
# The regional renderers therefore register DejaVuSans, which covers Latin
# Extended + Greek + Cyrillic (but NOT CJK — a Chinese CV still degrades).
#
# Note this cannot simply be switched on for the legacy six: their bullets are
# `self.cell(4, 5, "\x95")`, byte 0x95, which is U+2022 only under WinAnsi. The
# moment a Unicode TTF is registered that becomes a C1 control character and
# renders as nothing. Migrating them means changing every "\x95" in lockstep.

# ─────────────────────────────────────────────────────────────
# SECTION LABELS
# ─────────────────────────────────────────────────────────────
#
# A static table, deliberately not an AI translation. Section headings are a
# closed set of ~20 strings; asking the model to translate them yields drift
# between runs ("Expérience professionnelle" / "Expérience Pro" / "EXPERIENCE")
# and costs tokens to produce a worse, unreviewable result. The model decides
# WHICH language; this table decides WHICH WORDS.
#
# Adding a language is one entry here — no renderer changes. Any key missing
# from a language falls back to English rather than rendering an empty heading.

DEFAULT_LANG = "en"

LABELS = {
    "en": {
        "education": "Education",
        "education_training": "Education and training",
        "experience": "Experience",
        "professional_experience": "Professional Experience",
        "academic_positions": "Academic Positions",
        "skills": "Skills",
        "skills_tools": "Skills & Tools",
        "skills_languages": "Skills & Languages",
        "core_competencies": "Core Competencies",
        "summary": "Summary",
        "about_me": "About me",
        "work_experience": "Work experience",
        "personal_information": "Personal information",
        "languages": "Languages",
        "additional_information": "Additional information",
        # Europass gutter labels
        "address": "Address",
        "phone": "Phone",
        "email": "Email",
        "website": "Website",
        "linkedin": "LinkedIn",
        "date_of_birth": "Date of birth",
        "nationality": "Nationality",
        "driving_licence": "Driving licence",
        "mother_tongue": "Mother tongue",
        "language": "Language",
        "listening": "Listening",
        "reading": "Reading",
        "speaking": "Speaking",
        "writing": "Writing",
        "overall": "Overall",
    },
    "fr": {
        "education": "Formation",
        "education_training": "Formation et éducation",
        "experience": "Expérience",
        "professional_experience": "Expérience professionnelle",
        "academic_positions": "Postes académiques",
        "skills": "Compétences",
        "skills_tools": "Compétences et outils",
        "skills_languages": "Compétences et langues",
        "core_competencies": "Compétences clés",
        "summary": "Profil",
        "about_me": "À propos",
        "work_experience": "Expérience professionnelle",
        "personal_information": "Informations personnelles",
        "languages": "Langues",
        "additional_information": "Informations complémentaires",
        "address": "Adresse",
        "phone": "Téléphone",
        "email": "E-mail",
        "website": "Site web",
        "linkedin": "LinkedIn",
        "date_of_birth": "Date de naissance",
        "nationality": "Nationalité",
        "driving_licence": "Permis de conduire",
        "mother_tongue": "Langue maternelle",
        "language": "Langue",
        "listening": "Écoute",
        "reading": "Lecture",
        "speaking": "Expression orale",
        "writing": "Expression écrite",
        "overall": "Niveau global",
    },
}


class LabelMixin:
    """Gives every renderer `self.t(key)`. Defaults to English."""

    LANG = DEFAULT_LANG

    def t(self, key: str) -> str:
        table = LABELS.get(getattr(self, "LANG", DEFAULT_LANG), LABELS[DEFAULT_LANG])
        value = table.get(key)
        if value is None:
            value = LABELS[DEFAULT_LANG].get(key)
            if value is None:
                logger.warning("No label for key %r; falling back to the key itself.", key)
                return key
            logger.warning(
                "Label %r missing for language %r; using English.", key, self.LANG,
            )
        return value


FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "fonts")

_DEJAVU_VARIANTS = (
    ("", "DejaVuSans.ttf"),
    ("B", "DejaVuSans-Bold.ttf"),
    ("I", "DejaVuSans-Oblique.ttf"),
    ("BI", "DejaVuSans-BoldOblique.ttf"),
)


class UnicodeMixin(LabelMixin):
    """
    Registers a Unicode TTF family and makes sanitize() a passthrough.

    Degrades safely: if the font files are missing (a deploy that forgot to
    ship backend/static/fonts), it falls back to the core Helvetica family and
    the cp1252 round-trip rather than raising. A CV with a mangled accent beats
    a 500.
    """

    UNICODE_FONT = "DejaVu"
    FALLBACK_FONT = "Helvetica"
    BULLET = "•"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.FONT = self.FALLBACK_FONT
        self._unicode = False
        try:
            missing = [
                f for _, f in _DEJAVU_VARIANTS
                if not os.path.exists(os.path.join(FONT_DIR, f))
            ]
            if missing:
                logger.warning(
                    "Unicode fonts missing from %s (%s) - falling back to core fonts. "
                    "Non-Latin-1 characters will be replaced.",
                    FONT_DIR, ", ".join(missing),
                )
                return
            for style, filename in _DEJAVU_VARIANTS:
                self.add_font(self.UNICODE_FONT, style, os.path.join(FONT_DIR, filename))
            self.FONT = self.UNICODE_FONT
            self._unicode = True
        except Exception as e:
            logger.warning("Could not register Unicode fonts (%s) - using core fonts.", e)

    def sanitize(self, text):
        if not text:
            return ""
        text = str(text)
        if self._unicode:
            # The whole point of the TTF: nothing needs replacing.
            return text
        return text.encode("cp1252", "replace").decode("cp1252")


class LegacyFPDF(LabelMixin, FPDF):
    """
    Restores PyFPDF 1.x cursor semantics for the six original renderers.

    In PyFPDF 1.x, multi_cell() always left the cursor at the LEFT MARGIN on
    the next line. fpdf2 instead leaves it at the cell's own left edge
    (new_x=RIGHT/LMARGIN differences aside, the practical effect is that x is
    no longer reset). The legacy bullet pattern is:

        self.cell(2)                     # indent
        self.cell(4, 5, BULLET)          # the bullet glyph
        self.multi_cell(0, 5, text)      # the bullet text

    Under fpdf2 each bullet therefore starts ~6mm further right than the last,
    until the available width reaches zero and fpdf2 raises "Not enough
    horizontal space to render a single character" — i.e. any CV with more
    than a handful of bullets fails outright.

    Overriding multi_cell() here fixes all six renderers at once, instead of
    editing a hundred call sites. Explicit new_x/new_y at a call site still
    win, so future code can opt out.
    """

    def multi_cell(self, w, h=None, *args, **kwargs):
        if not any(k in kwargs for k in ("new_x", "new_y")):
            kwargs["new_x"] = XPos.LMARGIN
            kwargs["new_y"] = YPos.NEXT
        return super().multi_cell(w, h, *args, **kwargs)


# --- HELPER: HARVARD PDF GENERATOR ---
class HarvardPDF(LegacyFPDF):
    def sanitize(self, text):
        """Sanitize text to be compatible with FPDF latin-1 encoding."""
        if not text: return ""
        # Replace common incompatible characters
        replacements = {
            '\u2013': '-',  # en-dash
            '\u2014': '-',  # em-dash
            '\u2018': "'",  # left single quote
            '\u2019': "'",  # right single quote
            '\u201c': '"',  # left double quote
            '\u201d': '"',  # right double quote
            # '\u2022': '-',  # bullet (removed replacement)
        }
        for char, replacement in replacements.items():
            text = text.replace(char, replacement)
            
        # Final safety net: encode to cp1252 (supports bullets • at 0x95), replacing errors
        # FPDF standard fonts support cp1252
        return str(text).encode('cp1252', 'replace').decode('cp1252')

    def header_section(self, data):
        self.set_font("Times", "B", 24)
        name = data.get("name", "Name")
        if not name: name = "Name"
        self.cell(0, 10, self.sanitize(name).upper(), align="C", ln=True)
        
        self.set_font("Times", "", 10)
        parts = [
            data.get("address"),
            data.get("email"), 
            data.get("phone"), 
            data.get("linkedin"),
            data.get("website")
        ]
        contact = " | ".join([p for p in parts if p])
        self.cell(0, 5, self.sanitize(contact), align="C", ln=True)
        self.ln(5)

    def section_title(self, title):
        self.set_font("Times", "B", 12)
        self.cell(0, 6, self.sanitize(title).upper(), ln=True)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.ln(2)

    def add_education(self, edu_list):
        if not edu_list: return
        self.section_title(self.t("education"))
        for item in edu_list:
            self.set_font("Times", "B", 11)
            self.cell(100, 5, self.sanitize(item.get("school", "")), align="L")
            self.set_font("Times", "", 11)
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Times", "I", 11)
            self.cell(100, 5, self.sanitize(item.get("degree", "")), align="L")
            self.set_font("Times", "", 11)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.ln(3)

    def add_experience(self, exp_list):
        if not exp_list: return
        self.section_title(self.t("experience"))
        for item in exp_list:
            self.set_font("Times", "B", 11)
            self.cell(100, 5, self.sanitize(item.get("company", "")), align="L")
            self.set_font("Times", "", 11)
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Times", "I", 11)
            self.cell(100, 5, self.sanitize(item.get("role", "")), align="L")
            self.set_font("Times", "", 11)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            
            self.set_font("Times", "", 10)
            for bullet in item.get("bullets", []):
                # Small padding from start (reduced indentation)
                self.cell(2) 
                
                # Draw bullet manually to control size/position
                self.set_font("Times", "B", 14) # Larger bullet
                self.cell(4, 5, "\x95", align="C") # 0x95 is bullet in cp1252
                
                # Reset font for text
                self.set_font("Times", "", 10)
                
                # Sanitize text
                safe_bullet = self.sanitize(bullet)
                self.multi_cell(0, 5, safe_bullet)
            self.ln(4)

    def add_skills(self, skills_text):
        if not skills_text: return
        self.section_title(self.t("skills"))
        self.set_font("Times", "", 10)
        # Handle string vs list
        if isinstance(skills_text, list):
            skills_text = ", ".join(skills_text)
        
        safe_text = self.sanitize(skills_text)
        self.multi_cell(0, 5, safe_text)
        self.ln(5)


# --- HELPER: CHRONOLOGICAL CLASSIC PDF GENERATOR ---
class ChronologicalPDF(LegacyFPDF):
    def sanitize(self, text):
        """Sanitize text to be compatible with FPDF latin-1 encoding."""
        if not text: return ""
        replacements = {
            '\u2013': '-',  # en-dash
            '\u2014': '-',  # em-dash
            '\u2018': "'",  # left single quote
            '\u2019': "'",  # right single quote
            '\u201c': '"',  # left double quote
            '\u201d': '"',  # right double quote
        }
        for char, replacement in replacements.items():
            text = text.replace(char, replacement)
        return str(text).encode('cp1252', 'replace').decode('cp1252')

    def header_section(self, data):
        # Left-aligned name in Helvetica Bold
        self.set_font("Helvetica", "B", 20)
        name = data.get("name", "Name")
        if not name: name = "Name"
        self.cell(0, 10, self.sanitize(name).upper(), align="L", ln=True)
        
        # Contact line with pipe separators, left-aligned
        self.set_font("Helvetica", "", 10)
        self.set_text_color(85, 85, 85)  # #555555
        parts = [
            data.get("address"),
            data.get("phone"),
            data.get("email"), 
            data.get("linkedin"),
            data.get("website")
        ]
        contact = " | ".join([p for p in parts if p])
        self.cell(0, 5, self.sanitize(contact), align="L", ln=True)
        self.set_text_color(0, 0, 0)  # Reset to black
        self.ln(5)

    def section_title(self, title):
        self.set_font("Helvetica", "B", 12)
        self.cell(0, 7, self.sanitize(title).upper(), ln=True)
        # Full-width line
        self.set_draw_color(0, 0, 0)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.ln(3)

    def add_education(self, edu_list):
        if not edu_list: return
        self.section_title(self.t("education"))
        for item in edu_list:
            self.set_font("Helvetica", "B", 11)
            self.cell(100, 5, self.sanitize(item.get("school", "")), align="L")
            self.set_font("Helvetica", "", 11)
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Helvetica", "I", 11)
            self.cell(100, 5, self.sanitize(item.get("degree", "")), align="L")
            self.set_font("Helvetica", "", 11)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.ln(3)

    def add_experience(self, exp_list):
        if not exp_list: return
        self.section_title(self.t("experience"))
        for item in exp_list:
            self.set_font("Helvetica", "B", 11)
            self.cell(100, 5, self.sanitize(item.get("company", "")), align="L")
            self.set_font("Helvetica", "", 11)
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Helvetica", "I", 11)
            self.cell(100, 5, self.sanitize(item.get("role", "")), align="L")
            self.set_font("Helvetica", "", 11)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            
            self.set_font("Helvetica", "", 10)
            for bullet in item.get("bullets", []):
                self.cell(2)
                self.set_font("Helvetica", "B", 12)
                self.cell(4, 5, "\x95", align="C")  # bullet in cp1252
                self.set_font("Helvetica", "", 10)
                safe_bullet = self.sanitize(bullet)
                self.multi_cell(0, 5, safe_bullet)
            self.ln(4)

    def add_skills(self, skills_text):
        if not skills_text: return
        self.section_title(self.t("skills"))
        self.set_font("Helvetica", "", 10)
        if isinstance(skills_text, list):
            skills_text = ", ".join(skills_text)
        safe_text = self.sanitize(skills_text)
        self.multi_cell(0, 5, safe_text)
        self.ln(5)




# ─────────────────────────────────────────────────────────────
# HELPER: MODERN MINIMAL PDF GENERATOR
# ─────────────────────────────────────────────────────────────
class ModernMinimalPDF(LegacyFPDF):
    """Clean sans-serif, thin accent line under name, grey section labels."""

    ACCENT_R, ACCENT_G, ACCENT_B = 37, 99, 235   # #2563EB – Blue-600
    GREY_R,  GREY_G,  GREY_B   = 107, 114, 128   # #6B7280

    def sanitize(self, text):
        if not text: return ""
        replacements = {'\u2013':'-','\u2014':'-','\u2018':"'",'\u2019':"'",'\u201c':'"','\u201d':'"'}
        for k, v in replacements.items():
            text = text.replace(k, v)
        return str(text).encode('cp1252', 'replace').decode('cp1252')

    def header_section(self, data):
        # Name
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(31, 41, 55)  # near-black
        name = self.sanitize(data.get("name", "Name") or "Name")
        self.cell(0, 10, name, align="L", ln=True)

        # Thin accent line
        self.set_draw_color(self.ACCENT_R, self.ACCENT_G, self.ACCENT_B)
        self.set_line_width(0.6)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.set_line_width(0.2)
        self.ln(3)

        # Contact line
        self.set_font("Helvetica", "", 9)
        self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
        parts = [data.get("address"), data.get("phone"), data.get("email"), data.get("linkedin"), data.get("website")]
        contact = " \xb7 ".join([p for p in parts if p])  # middle dot separator
        self.cell(0, 5, self.sanitize(contact), align="L", ln=True)
        self.set_text_color(0, 0, 0)
        self.ln(4)

    def section_title(self, title):
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
        self.cell(0, 5, self.sanitize(title).upper(), ln=True)
        # Thin grey rule
        self.set_draw_color(self.GREY_R, self.GREY_G, self.GREY_B)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.set_draw_color(0, 0, 0)
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def add_education(self, edu_list):
        if not edu_list: return
        self.section_title(self.t("education"))
        for item in edu_list:
            self.set_font("Helvetica", "B", 10)
            self.set_text_color(31, 41, 55)
            self.cell(110, 5, self.sanitize(item.get("school", "")), align="L")
            self.set_font("Helvetica", "", 10)
            self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Helvetica", "", 10)
            self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
            self.cell(0, 5, self.sanitize(item.get("degree", "") + "  " + item.get("location", "")), align="L", ln=True)
            self.set_text_color(0, 0, 0)
            self.ln(2)

    def add_experience(self, exp_list):
        if not exp_list: return
        self.section_title(self.t("experience"))
        for item in exp_list:
            self.set_font("Helvetica", "B", 10)
            self.set_text_color(31, 41, 55)
            self.cell(110, 5, self.sanitize(item.get("company", "")), align="L")
            self.set_font("Helvetica", "", 9)
            self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Helvetica", "", 10)
            self.set_text_color(self.ACCENT_R, self.ACCENT_G, self.ACCENT_B)
            self.cell(0, 5, self.sanitize(item.get("role", "") + "  ·  " + item.get("location", "")), align="L", ln=True)
            self.set_text_color(0, 0, 0)
            self.set_font("Helvetica", "", 10)
            for bullet in item.get("bullets", []):
                self.cell(2)
                self.set_font("Helvetica", "B", 11)
                self.set_text_color(self.ACCENT_R, self.ACCENT_G, self.ACCENT_B)
                self.cell(4, 5, "\x95", align="C")
                self.set_font("Helvetica", "", 10)
                self.set_text_color(0, 0, 0)
                self.multi_cell(0, 5, self.sanitize(bullet))
            self.ln(3)

    def add_skills(self, skills_text):
        if not skills_text: return
        self.section_title(self.t("skills"))
        self.set_font("Helvetica", "", 10)
        if isinstance(skills_text, list):
            skills_text = "  ·  ".join(skills_text)
        self.multi_cell(0, 5, self.sanitize(skills_text))
        self.ln(4)


# ─────────────────────────────────────────────────────────────
# HELPER: EXECUTIVE BOLD PDF GENERATOR
# ─────────────────────────────────────────────────────────────
class ExecutiveBoldPDF(LegacyFPDF):
    """Commanding executive layout: centered name, gold accents, heavy section lines."""

    DARK_R, DARK_G, DARK_B = 30, 41, 59     # #1E293B – Slate-800
    GOLD_R, GOLD_G, GOLD_B = 180, 83, 9     # #B45309 – Amber-700

    def sanitize(self, text):
        if not text: return ""
        replacements = {'\u2013':'-','\u2014':'-','\u2018':"'",'\u2019':"'",'\u201c':'"','\u201d':'"'}
        for k, v in replacements.items():
            text = text.replace(k, v)
        return str(text).encode('cp1252', 'replace').decode('cp1252')

    def header_section(self, data):
        # Double rule at top
        self.set_draw_color(self.DARK_R, self.DARK_G, self.DARK_B)
        self.set_line_width(1.2)
        self.line(10, self.get_y(), 200, self.get_y())
        self.set_line_width(0.3)
        self.line(10, self.get_y() + 2.5, 200, self.get_y() + 2.5)
        self.ln(5)

        # Name centered
        self.set_font("Times", "B", 24)
        self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
        name = self.sanitize((data.get("name", "Name") or "Name").upper())
        self.cell(0, 12, name, align="C", ln=True)

        # Job title in gold
        job_title = data.get("job_title", "") or data.get("summary", "")
        if job_title:
            self.set_font("Times", "I", 13)
            self.set_text_color(self.GOLD_R, self.GOLD_G, self.GOLD_B)
            self.cell(0, 6, self.sanitize(job_title), align="C", ln=True)

        # Contact centered
        self.set_font("Times", "", 10)
        self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
        parts = [data.get("address"), data.get("phone"), data.get("email"), data.get("linkedin")]
        contact = "  \xb7  ".join([p for p in parts if p])
        self.cell(0, 6, self.sanitize(contact), align="C", ln=True)

        # Bottom double rule
        self.ln(2)
        self.set_line_width(0.3)
        self.line(10, self.get_y(), 200, self.get_y())
        self.set_line_width(1.2)
        self.line(10, self.get_y() + 2.5, 200, self.get_y() + 2.5)
        self.set_line_width(0.2)
        self.set_text_color(0, 0, 0)
        self.ln(8)

    def section_title(self, title):
        self.set_font("Times", "B", 13)
        self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
        self.cell(0, 7, self.sanitize(title).upper(), ln=True)
        # Gold rule
        self.set_draw_color(self.GOLD_R, self.GOLD_G, self.GOLD_B)
        self.set_line_width(0.8)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.set_line_width(0.2)
        self.set_draw_color(0, 0, 0)
        self.set_text_color(0, 0, 0)
        self.ln(3)

    def add_education(self, edu_list):
        if not edu_list: return
        self.section_title(self.t("education"))
        for item in edu_list:
            self.set_font("Times", "B", 11)
            self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
            self.cell(110, 5, self.sanitize(item.get("school", "")), align="L")
            self.set_font("Times", "", 11)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Times", "I", 11)
            self.set_text_color(0, 0, 0)
            self.cell(110, 5, self.sanitize(item.get("degree", "")), align="L")
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.ln(3)

    def add_experience(self, exp_list):
        if not exp_list: return
        self.section_title(self.t("professional_experience"))
        for item in exp_list:
            self.set_font("Times", "B", 11)
            self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
            self.cell(110, 5, self.sanitize(item.get("company", "")), align="L")
            self.set_font("Times", "", 11)
            self.set_text_color(0, 0, 0)
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Times", "BI", 11)
            self.set_text_color(self.GOLD_R, self.GOLD_G, self.GOLD_B)
            self.cell(110, 5, self.sanitize(item.get("role", "")), align="L")
            self.set_font("Times", "", 11)
            self.set_text_color(0, 0, 0)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Times", "", 10.5)
            for bullet in item.get("bullets", []):
                self.cell(2)
                self.set_font("Times", "B", 14)
                self.set_text_color(self.GOLD_R, self.GOLD_G, self.GOLD_B)
                self.cell(4, 5, "\x95", align="C")
                self.set_font("Times", "", 10.5)
                self.set_text_color(0, 0, 0)
                self.multi_cell(0, 5, self.sanitize(bullet))
            self.ln(4)

    def add_skills(self, skills_text):
        if not skills_text: return
        self.section_title(self.t("core_competencies"))
        self.set_font("Times", "", 10.5)
        if isinstance(skills_text, list):
            skills_text = "  •  ".join(skills_text)
        self.multi_cell(0, 5, self.sanitize(skills_text))
        self.ln(5)


# ─────────────────────────────────────────────────────────────
# HELPER: CREATIVE TECH PDF GENERATOR
# ─────────────────────────────────────────────────────────────
class CreativeTechPDF(LegacyFPDF):
    """Violet accent headers, role in accent color, clean sans-serif body."""

    PURPLE_R, PURPLE_G, PURPLE_B = 124, 58, 237   # #7C3AED – Violet-600
    DARK_R,   DARK_G,   DARK_B   =  31, 41,  55   # #1F2937 – Grey-800
    GREY_R,   GREY_G,   GREY_B   = 107, 114, 128  # #6B7280

    def sanitize(self, text):
        if not text: return ""
        replacements = {'\u2013':'-','\u2014':'-','\u2018':"'",'\u2019':"'",'\u201c':'"','\u201d':'"'}
        for k, v in replacements.items():
            text = text.replace(k, v)
        return str(text).encode('cp1252', 'replace').decode('cp1252')

    def header_section(self, data):
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
        name = self.sanitize(data.get("name", "Name") or "Name")
        self.cell(0, 10, name, align="L", ln=True)

        # Job title / headline in violet
        job_title = data.get("job_title", "") or ""
        if job_title:
            self.set_font("Helvetica", "", 12)
            self.set_text_color(self.PURPLE_R, self.PURPLE_G, self.PURPLE_B)
            self.cell(0, 5, self.sanitize(job_title), align="L", ln=True)

        # Thin violet rule
        self.set_draw_color(self.PURPLE_R, self.PURPLE_G, self.PURPLE_B)
        self.set_line_width(0.5)
        self.line(self.get_x(), self.get_y() + 1, 190, self.get_y() + 1)
        self.set_line_width(0.2)
        self.set_draw_color(0, 0, 0)
        self.ln(5)

        # Contact
        self.set_font("Helvetica", "", 9)
        self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
        parts = [data.get("address"), data.get("email"), data.get("website"), data.get("linkedin")]
        contact = "  \xb7  ".join([p for p in parts if p])
        self.cell(0, 5, self.sanitize(contact), align="L", ln=True)
        self.set_text_color(0, 0, 0)
        self.ln(4)

    def section_title(self, title):
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(self.PURPLE_R, self.PURPLE_G, self.PURPLE_B)
        self.cell(0, 6, self.sanitize(title).upper(), ln=True)
        self.set_draw_color(self.PURPLE_R, self.PURPLE_G, self.PURPLE_B)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.set_draw_color(0, 0, 0)
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def add_education(self, edu_list):
        if not edu_list: return
        self.section_title(self.t("education"))
        for item in edu_list:
            self.set_font("Helvetica", "B", 10)
            self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
            self.cell(110, 5, self.sanitize(item.get("school", "")), align="L")
            self.set_font("Helvetica", "", 9)
            self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Helvetica", "", 10)
            self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
            self.cell(0, 5, self.sanitize(item.get("degree", "") + "  " + item.get("location", "")), ln=True)
            self.set_text_color(0, 0, 0)
            self.ln(2)

    def add_experience(self, exp_list):
        if not exp_list: return
        self.section_title(self.t("experience"))
        for item in exp_list:
            self.set_font("Helvetica", "B", 10)
            self.set_text_color(self.DARK_R, self.DARK_G, self.DARK_B)
            self.cell(110, 5, self.sanitize(item.get("company", "")), align="L")
            self.set_font("Helvetica", "", 9)
            self.set_text_color(self.GREY_R, self.GREY_G, self.GREY_B)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Helvetica", "", 10)
            self.set_text_color(self.PURPLE_R, self.PURPLE_G, self.PURPLE_B)
            self.cell(0, 5, self.sanitize(item.get("role", "") + "  ·  " + item.get("location", "")), ln=True)
            self.set_text_color(0, 0, 0)
            self.set_font("Helvetica", "", 10)
            for bullet in item.get("bullets", []):
                self.cell(2)
                self.set_font("Helvetica", "B", 11)
                self.set_text_color(self.PURPLE_R, self.PURPLE_G, self.PURPLE_B)
                self.cell(4, 5, "\x95", align="C")
                self.set_font("Helvetica", "", 10)
                self.set_text_color(0, 0, 0)
                self.multi_cell(0, 5, self.sanitize(bullet))
            self.ln(3)

    def add_skills(self, skills_text):
        if not skills_text: return
        self.section_title(self.t("skills_tools"))
        self.set_font("Helvetica", "", 10)
        if isinstance(skills_text, list):
            skills_text = "  ·  ".join(skills_text)
        self.multi_cell(0, 5, self.sanitize(skills_text))
        self.ln(4)


# ─────────────────────────────────────────────────────────────
# HELPER: ACADEMIC SCHOLAR PDF GENERATOR
# ─────────────────────────────────────────────────────────────
class AcademicScholarPDF(LegacyFPDF):
    """Deep navy serif, centered header, research/publication forward layout."""

    NAVY_R, NAVY_G, NAVY_B = 30, 58, 95   # #1E3A5F

    def sanitize(self, text):
        if not text: return ""
        replacements = {'\u2013':'-','\u2014':'-','\u2018':"'",'\u2019':"'",'\u201c':'"','\u201d':'"'}
        for k, v in replacements.items():
            text = text.replace(k, v)
        return str(text).encode('cp1252', 'replace').decode('cp1252')

    def header_section(self, data):
        self.set_font("Times", "B", 20)
        self.set_text_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
        name = self.sanitize(data.get("name", "Name") or "Name")
        self.cell(0, 10, name, align="C", ln=True)

        job_title = data.get("job_title", "") or data.get("summary", "")
        if job_title:
            self.set_font("Times", "I", 11)
            self.cell(0, 5, self.sanitize(job_title), align="C", ln=True)

        # Navy rule
        self.set_draw_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
        self.set_line_width(0.8)
        self.line(10, self.get_y(), 200, self.get_y())
        self.set_line_width(0.2)

        self.set_font("Times", "", 10)
        self.set_text_color(55, 65, 81)
        parts = [data.get("address"), data.get("phone"), data.get("email"), data.get("website"), data.get("linkedin")]
        contact = "  \xb7  ".join([p for p in parts if p])
        self.cell(0, 6, self.sanitize(contact), align="C", ln=True)

        # Bottom rule
        self.set_draw_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
        self.line(10, self.get_y(), 200, self.get_y())
        self.set_draw_color(0, 0, 0)
        self.set_text_color(0, 0, 0)
        self.ln(6)

    def section_title(self, title):
        self.set_font("Times", "B", 12)
        self.set_text_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
        self.cell(0, 6, self.sanitize(title).upper(), ln=True)
        self.set_draw_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
        self.set_line_width(0.5)
        self.line(self.get_x(), self.get_y(), 190, self.get_y())
        self.set_line_width(0.2)
        self.set_draw_color(0, 0, 0)
        self.set_text_color(0, 0, 0)
        self.ln(3)

    def add_education(self, edu_list):
        if not edu_list: return
        self.section_title(self.t("education"))
        for item in edu_list:
            self.set_font("Times", "B", 11)
            self.set_text_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
            self.cell(110, 5, self.sanitize(item.get("school", "")), align="L")
            self.set_font("Times", "", 11)
            self.set_text_color(0, 0, 0)
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Times", "I", 11)
            self.cell(110, 5, self.sanitize(item.get("degree", "")), align="L")
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Times", "", 10.5)
            for bullet in item.get("bullets", []):
                self.cell(2)
                self.set_font("Times", "B", 13)
                self.cell(4, 5, "\x95", align="C")
                self.set_font("Times", "", 10.5)
                self.multi_cell(0, 5, self.sanitize(bullet))
            self.ln(3)

    def add_experience(self, exp_list):
        if not exp_list: return
        self.section_title(self.t("academic_positions"))
        for item in exp_list:
            self.set_font("Times", "B", 11)
            self.set_text_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
            self.cell(110, 5, self.sanitize(item.get("company", "")), align="L")
            self.set_font("Times", "", 11)
            self.set_text_color(0, 0, 0)
            self.cell(0, 5, self.sanitize(item.get("location", "")), align="R", ln=True)
            self.set_font("Times", "I", 11)
            self.cell(110, 5, self.sanitize(item.get("role", "")), align="L")
            self.cell(0, 5, self.sanitize(item.get("date", "")), align="R", ln=True)
            self.set_font("Times", "", 10.5)
            for bullet in item.get("bullets", []):
                self.cell(2)
                self.set_font("Times", "B", 13)
                self.set_text_color(self.NAVY_R, self.NAVY_G, self.NAVY_B)
                self.cell(4, 5, "\x95", align="C")
                self.set_font("Times", "", 10.5)
                self.set_text_color(0, 0, 0)
                self.multi_cell(0, 5, self.sanitize(bullet))
            self.ln(4)

    def add_skills(self, skills_text):
        if not skills_text: return
        self.section_title(self.t("skills_languages"))
        self.set_font("Times", "", 10.5)
        if isinstance(skills_text, list):
            skills_text = ", ".join(skills_text)
        self.multi_cell(0, 6, self.sanitize(skills_text))
        self.ln(4)


# ─────────────────────────────────────────────────────────────
# REGIONAL FORMAT: EUROPASS (EU)
# ─────────────────────────────────────────────────────────────
class EuropassPDF(UnicodeMixin, FPDF):
    """
    Europass-style CV: a narrow left gutter carrying dates and labels, a wide
    body column, and a CEFR self-assessment table for languages.

    Deliberately does NOT reproduce official Europass branding (EU flag, blue
    header band) — that is a trademark question, it is hostile to ATS parsers,
    and it does not help the candidate. The value is the structure.
    """

    GREY = (90, 90, 96)
    RULE = (170, 170, 176)

    LABEL_X = 15.0
    LABEL_W = 36.0
    GUTTER = 6.0
    LABEL_H = 4.5
    BODY_H = 5.0
    PHOTO_W = 25.0
    PHOTO_H = 33.3          # fixed 3:4 — save_photo() guarantees the aspect

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.set_margins(self.LABEL_X, 15, 15)
        self.body_x = self.LABEL_X + self.LABEL_W + self.GUTTER
        self.body_w = self.w - self.r_margin - self.body_x

    # ── primitives ───────────────────────────────────────────────────────
    def _height_of(self, w, h, text):
        """Measure without drawing. This is why the format needs fpdf2."""
        if not text:
            return 0.0
        return self.multi_cell(w, h, text, dry_run=True, output="HEIGHT")

    def row(self, label, body, body_style="", body_size=10):
        """
        One gutter row. Both columns are measured BEFORE anything is drawn, so
        a page break can be taken cleanly instead of orphaning the label on the
        previous page.
        """
        label = self.sanitize(label or "")
        body = self.sanitize(body or "")
        if not body and not label:
            return

        self.set_font(self.FONT, "B", 9)
        h_label = self._height_of(self.LABEL_W, self.LABEL_H, label)
        self.set_font(self.FONT, body_style, body_size)
        h_body = self._height_of(self.body_w, self.BODY_H, body)
        need = max(h_label, h_body)

        if self.get_y() + need > self.page_break_trigger:
            self.add_page()

        y0 = self.get_y()
        if label:
            self.set_xy(self.LABEL_X, y0)
            self.set_font(self.FONT, "B", 9)
            self.set_text_color(*self.GREY)
            # align="L": fpdf2 justifies by default, which stretches a
            # two-word label ("Permis de conduire") across the gutter.
            self.multi_cell(self.LABEL_W, self.LABEL_H, label, align="L")
        if body:
            self.set_xy(self.body_x, y0)
            self.set_font(self.FONT, body_style, body_size)
            self.set_text_color(0, 0, 0)
            self.multi_cell(self.body_w, self.BODY_H, body)

        self.set_xy(self.LABEL_X, y0 + need + 1.2)

    def section_title(self, title):
        if self.get_y() + 14 > self.page_break_trigger:
            self.add_page()
        self.ln(3)
        self.set_font(self.FONT, "B", 10)
        self.set_text_color(0, 0, 0)
        self.set_x(self.LABEL_X)
        self.cell(0, 6, self.sanitize(title).upper(), ln=True)
        self.set_draw_color(*self.RULE)
        y = self.get_y()
        self.line(self.LABEL_X, y, self.w - self.r_margin, y)
        self.ln(2.5)

    # ── sections ─────────────────────────────────────────────────────────
    def header_section(self, data):
        photo = getattr(self, "photo_path", None)
        text_w = self.w - self.r_margin - self.LABEL_X
        photo_bottom = 0.0
        if photo and os.path.exists(photo):
            try:
                self.image(
                    photo,
                    x=self.w - self.r_margin - self.PHOTO_W,
                    y=self.t_margin,
                    w=self.PHOTO_W,
                    h=self.PHOTO_H,
                )
                text_w -= self.PHOTO_W + 5
                photo_bottom = self.t_margin + self.PHOTO_H
            except Exception as e:
                logger.warning("Could not embed photo %s: %s", photo, e)

        self.set_xy(self.LABEL_X, self.t_margin)
        self.set_font(self.FONT, "B", 20)
        self.multi_cell(text_w, 8, self.sanitize(data.get("name") or "Name"))

        job_title = data.get("job_title")
        if job_title:
            self.set_x(self.LABEL_X)
            self.set_font(self.FONT, "", 11)
            self.set_text_color(*self.GREY)
            self.multi_cell(text_w, 5.5, self.sanitize(job_title))
            self.set_text_color(0, 0, 0)

        # The name and job title are narrowed to clear the photo, but the
        # section rule and the Address/Phone rows below span the full width and
        # would otherwise be drawn straight underneath it. Drop past the photo
        # first. Only matters when the header text is shorter than the photo.
        self.set_y(max(self.get_y(), photo_bottom))

        self.ln(3)
        self.section_title(self.t("personal_information"))

        # Only rows the source CV actually provided. Nothing is invented, and
        # nothing shows an empty label.
        for label, value in (
            (self.t("address"), data.get("address")),
            (self.t("phone"), data.get("phone")),
            (self.t("email"), data.get("email")),
            (self.t("website"), data.get("website")),
            (self.t("linkedin"), data.get("linkedin")),
            (self.t("date_of_birth"), data.get("date_of_birth")),
            (self.t("nationality"), data.get("nationality")),
        ):
            if value:
                self.row(label, str(value))

        # Keep the cursor clear of the photo before the next section starts.
        if photo and os.path.exists(photo):
            self.set_y(max(self.get_y(), self.t_margin + self.PHOTO_H + 4))

    def add_summary(self, summary):
        if not summary:
            return
        self.section_title(self.t("about_me"))
        self.row("", summary)

    def add_experience(self, exp_list):
        if not exp_list:
            return
        self.section_title(self.t("work_experience"))
        for item in exp_list:
            role = item.get("role") or ""
            company = " - ".join(
                [p for p in (item.get("company"), item.get("location")) if p]
            )
            body = role
            if company:
                body = f"{role}\n{company}" if role else company
            self.row(item.get("date") or "", body, body_style="B", body_size=10.5)

            bullets = [b for b in (item.get("bullets") or []) if b]
            if bullets:
                self.row("", "\n".join(f"{self.BULLET} {b}" for b in bullets))
            self.ln(1.5)

    def add_education(self, edu_list):
        if not edu_list:
            return
        self.section_title(self.t("education_training"))
        for item in edu_list:
            degree = item.get("degree") or ""
            school = " - ".join(
                [p for p in (item.get("school"), item.get("location")) if p]
            )
            body = degree
            if school:
                body = f"{degree}\n{school}" if degree else school
            self.row(item.get("date") or "", body, body_style="B", body_size=10.5)
            self.ln(1.5)

    def add_skills(self, skills_text):
        if not skills_text:
            return
        if isinstance(skills_text, list):
            skills_text = ", ".join(str(s) for s in skills_text)
        self.section_title(self.t("skills"))
        self.row("", skills_text)

    def add_languages(self, languages):
        """
        CEFR self-assessment table. A language with `mother_tongue` renders as
        a single spanning cell; one with only an `overall` level spans the four
        skill columns rather than repeating a level it was never given.
        """
        if not languages:
            return
        self.section_title(self.t("languages"))

        cols = tuple(self.t(k) for k in ("listening", "reading", "speaking", "writing"))
        name_w = 42.0
        avail = self.w - self.r_margin - self.LABEL_X - name_w
        col_w = avail / len(cols)
        row_h = 6.0

        if self.get_y() + row_h * (len(languages) + 1) > self.page_break_trigger:
            self.add_page()

        # header
        self.set_x(self.LABEL_X)
        self.set_font(self.FONT, "B", 8)
        self.set_text_color(*self.GREY)
        self.cell(name_w, row_h, self.sanitize(self.t("language")), border="B")
        for c in cols:
            self.cell(col_w, row_h, self.sanitize(c), border="B", align="C")
        self.ln(row_h)

        self.set_text_color(0, 0, 0)
        for lang in languages:
            if not isinstance(lang, dict):
                continue
            name = lang.get("language")
            if not name:
                continue
            if self.get_y() + row_h > self.page_break_trigger:
                self.add_page()
            self.set_x(self.LABEL_X)
            self.set_font(self.FONT, "B", 9)
            self.cell(name_w, row_h, self.sanitize(name), border="B")
            self.set_font(self.FONT, "", 9)

            if lang.get("mother_tongue"):
                self.cell(
                    col_w * len(cols), row_h,
                    self.sanitize(self.t("mother_tongue")), border="B", align="C",
                )
            elif lang.get("overall") and not any(
                lang.get(k.lower()) for k in cols
            ):
                self.cell(
                    col_w * len(cols), row_h,
                    self.sanitize(str(lang["overall"])), border="B", align="C",
                )
            else:
                for c in cols:
                    level = lang.get(c.lower()) or lang.get("overall") or "-"
                    self.cell(col_w, row_h, self.sanitize(str(level)),
                              border="B", align="C")
            self.ln(row_h)
        self.ln(2)

    def add_additional(self, payload):
        """Trailing odds and ends — currently just the driving licence."""
        extras = []
        if payload.get("driving_licence"):
            extras.append((self.t("driving_licence"), str(payload["driving_licence"])))
        if not extras:
            return
        self.section_title(self.t("additional_information"))
        for label, value in extras:
            self.row(label, value)


# ─────────────────────────────────────────────────────────────
# REGIONAL FORMAT: US / CANADA
# ─────────────────────────────────────────────────────────────
class USCanadaPDF(UnicodeMixin, FPDF):
    """
    A US/Canadian resume: no photo, no personal details, experience before
    education, US Letter.

    Written standalone rather than subclassing ChronologicalPDF because that
    class hard-codes "Helvetica" (a core font, so no Unicode) and a literal
    `190` right edge that would leave a visibly short rule on Letter's 215.9 mm
    width.
    """

    GREY = (85, 85, 85)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.set_margins(15, 15, 15)

    def _right(self):
        return self.w - self.r_margin

    def _content_w(self):
        return self.w - self.l_margin - self.r_margin

    def section_title(self, title):
        if self.get_y() + 16 > self.page_break_trigger:
            self.add_page()
        self.set_font(self.FONT, "B", 11)
        self.set_text_color(0, 0, 0)
        self.cell(0, 7, self.sanitize(title).upper(), ln=True)
        self.set_draw_color(0, 0, 0)
        y = self.get_y()
        self.line(self.l_margin, y, self._right(), y)
        self.ln(2.5)

    def _split_row(self, left, right, left_style="B", size=11):
        """Left-aligned label with a right-aligned counterpart on one line."""
        w = self._content_w()
        self.set_font(self.FONT, left_style, size)
        self.cell(w * 0.68, 5, self.sanitize(left), align="L")
        self.set_font(self.FONT, "", size)
        self.cell(w * 0.32, 5, self.sanitize(right), align="R", ln=True)

    def header_section(self, data):
        self.set_font(self.FONT, "B", 19)
        self.cell(0, 9, self.sanitize(data.get("name") or "Name").upper(),
                  align="L", ln=True)

        if data.get("job_title"):
            self.set_font(self.FONT, "", 11)
            self.set_text_color(*self.GREY)
            self.cell(0, 5.5, self.sanitize(data["job_title"]),
                      align="L", ln=True)

        # date_of_birth / nationality are absent by the time we get here — the
        # dispatcher strips them for this format. Not listing them is the point.
        parts = [
            data.get("address"), data.get("phone"), data.get("email"),
            data.get("linkedin"), data.get("website"),
        ]
        contact = "  |  ".join([str(p) for p in parts if p])
        if contact:
            self.set_font(self.FONT, "", 9.5)
            self.set_text_color(*self.GREY)
            self.multi_cell(0, 5, self.sanitize(contact))
        self.set_text_color(0, 0, 0)
        self.ln(3)

    def add_summary(self, summary):
        if not summary:
            return
        self.section_title(self.t("summary"))
        self.set_font(self.FONT, "", 10)
        self.multi_cell(0, 5, self.sanitize(summary))
        self.ln(3)

    def add_experience(self, exp_list):
        if not exp_list:
            return
        self.section_title(self.t("experience"))
        for item in exp_list:
            self._split_row(item.get("company", ""), item.get("location", ""))
            self._split_row(item.get("role", ""), item.get("date", ""),
                            left_style="I")
            self.set_font(self.FONT, "", 10)
            indent = 6.0
            for bullet in item.get("bullets", []) or []:
                if not bullet:
                    continue
                # Take the page break BEFORE drawing anything.
                #
                # The glyph and the text are positioned from a shared `y`. If
                # cell() is allowed to take the break implicitly, it draws the
                # glyph at the top of the new page — and then set_xy() restores
                # the saved bottom-of-page `y`, now pointing near the bottom of
                # the NEW page, so multi_cell() breaks a second time and the
                # text lands on the page after. The result is a page containing
                # nothing but a bullet dot.
                #
                # Only the first line has to fit; multi_cell() splits the rest
                # across the break by itself.
                if self.get_y() + 5 > self.page_break_trigger:
                    self.add_page()
                y = self.get_y()
                self.set_xy(self.l_margin + 2, y)
                self.cell(4, 5, self.BULLET, align="C")
                # Explicit width and an explicit return to the left margin:
                # multi_cell(0, ...) would measure from the current x and, since
                # fpdf2 leaves the cursor at the cell's left edge, each bullet
                # would start 6 mm further right than the last.
                self.set_xy(self.l_margin + indent, y)
                self.multi_cell(
                    self._content_w() - indent, 5, self.sanitize(bullet),
                )
            self.ln(3.5)

    def add_education(self, edu_list):
        if not edu_list:
            return
        self.section_title(self.t("education"))
        for item in edu_list:
            self._split_row(item.get("school", ""), item.get("location", ""))
            self._split_row(item.get("degree", ""), item.get("date", ""),
                            left_style="I")
            self.ln(2.5)

    def add_skills(self, skills_text):
        if not skills_text:
            return
        if isinstance(skills_text, list):
            skills_text = ", ".join(str(s) for s in skills_text)
        self.section_title(self.t("skills"))
        self.set_font(self.FONT, "", 10)
        self.multi_cell(0, 5, self.sanitize(skills_text))
        self.ln(4)


# ─────────────────────────────────────────────────────────────
# MAIN PDF GENERATION ENTRY POINT
# ─────────────────────────────────────────────────────────────

# Section key -> (renderer method, payload key). A None key means the method
# receives the whole payload rather than one branch of it.
SECTION_METHODS = {
    "header":     ("header_section", "header"),
    "summary":    ("add_summary",    "summary"),
    "education":  ("add_education",  "education"),
    "experience": ("add_experience", "experience"),
    "skills":     ("add_skills",     "skills"),
    "languages":  ("add_languages",  "languages"),
    "additional": ("add_additional",  None),
}

RENDERERS = {
    "HarvardPDF": HarvardPDF,
    "ChronologicalPDF": ChronologicalPDF,
    "ModernMinimalPDF": ModernMinimalPDF,
    "ExecutiveBoldPDF": ExecutiveBoldPDF,
    "CreativeTechPDF": CreativeTechPDF,
    "AcademicScholarPDF": AcademicScholarPDF,
    "EuropassPDF": EuropassPDF,
    "USCanadaPDF": USCanadaPDF,
}


def generate_improved_pdf(
    data: dict,
    output_path: str,
    template_id: str = "professional",
    photo_path: str = None,
):
    """
    Render the extracted CV data to PDF.

    The template spec decides which sections are emitted and in what order, so
    formats can differ structurally (Europass puts experience before
    education), not just visually.
    """
    try:
        spec = get_template(template_id)
        logger.info(
            "Generating PDF at %s (template=%s renderer=%s format=%s)",
            output_path, spec.id, spec.renderer, spec.page_format,
        )

        # Never mutate the caller's dict: in main.py the same object is dumped
        # to _debug.json AND returned in the /api/upload-resume response body,
        # so stripping fields in place would silently remove them from the
        # payload the app receives.
        payload = copy.deepcopy(data) if data else {}
        if spec.suppress:
            header = payload.get("header")
            if isinstance(header, dict):
                for field_name in spec.suppress:
                    header.pop(field_name, None)

        pdf = RENDERERS[spec.renderer](format=spec.page_format)
        # A format with photo="none" never sees the file, even if one exists.
        pdf.photo_path = photo_path if spec.photo != "none" else None

        # Headings follow the language of the CV's prose, not the format's
        # region: a French CV in the US/Canada format still gets French
        # headings, because they sit directly above French text. ai_service
        # persists this on the payload, so re-rendering into another format
        # later resolves to the same language instead of reverting to English.
        lang = (payload.get("language") or DEFAULT_LANG).lower()
        if lang not in LABELS:
            logger.warning("No label table for language %r; using %r.", lang, DEFAULT_LANG)
            lang = DEFAULT_LANG
        pdf.LANG = lang

        pdf.add_page()
        pdf.set_auto_page_break(auto=True, margin=15)

        for section in spec.sections:
            method_name, key = SECTION_METHODS.get(section, (None, None))
            if not method_name:
                logger.warning("Unknown section %r in template %s", section, spec.id)
                continue
            fn = getattr(pdf, method_name, None)
            if fn is None:
                # Legacy renderers don't implement add_summary/add_languages.
                continue
            if key is None:
                fn(payload)
            elif payload.get(key):
                fn(payload[key])

        pdf.output(output_path)
        logger.info("PDF generated successfully")

    except Exception as e:
        logger.error(f"Error generating PDF: {str(e)}", exc_info=True)
        raise Exception(f"Error generating PDF: {str(e)}")

