"""
CV template registry.

A template is a *specification*, not a class hierarchy: it names a renderer, the
sections to emit and in what order, the page size, and a few policy flags
(photo, suppressed fields, region). `pdf_service.generate_improved_pdf` reads
this spec and drives the renderer accordingly.

Two axes live here behind one flat `template_id`:

  · visual style    — the six original templates, all US-shaped
  · regional format — europass, us_canada (and later uk, lebenslauf)

Keeping `template_id` a single opaque string matters: it crosses four
boundaries (upload form field -> {file_id}_debug.json -> GeneratePDFRequest ->
client state). A {format, style} pair would change all four.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

# Photo policy for a format:
#   "none"     — never render a photo (US/Canada: it's a discrimination risk)
#   "optional" — render one if the user supplied it (Europass)
#   "expected" — conventional for this market (German Lebenslauf, later)
PHOTO_NONE = "none"
PHOTO_OPTIONAL = "optional"
PHOTO_EXPECTED = "expected"

# Section keys understood by the dispatcher. See pdf_service.SECTION_METHODS.
DEFAULT_SECTIONS: Tuple[str, ...] = ("header", "education", "experience", "skills")


@dataclass(frozen=True)
class TemplateSpec:
    id: str
    name: str
    description: str
    preview_image: str
    # Class name in pdf_service — resolved through pdf_service.RENDERERS.
    renderer: str
    # Sections to emit, in order. The default reproduces the historical
    # hard-coded sequence exactly, so the six style templates are unchanged.
    sections: Tuple[str, ...] = DEFAULT_SECTIONS
    page_format: str = "A4"                 # "A4" | "Letter"
    region: Optional[str] = None            # "eu" | "us_ca" | "uk" | "de"
    photo: str = PHOTO_NONE
    # Header fields stripped before rendering, whatever the extraction produced.
    # This is a hard control, independent of the prompt rules.
    suppress: Tuple[str, ...] = ()
    # Short label shown on the picker thumbnail, e.g. "EU standard".
    badge: Optional[str] = None


# ── Registry ──────────────────────────────────────────────────────────────
#
# ORDER IS LOAD-BEARING. Older app builds do
# `setSelectedTemplate(templates[0].id)`, so the six original entries must stay
# first and in their original order. Append new formats; never reorder.

TEMPLATES: Dict[str, TemplateSpec] = {
    "professional": TemplateSpec(
        id="professional",
        name="Harvard CV Format",
        description=(
            "Traditional Harvard-style CV with centered header, perfect for "
            "academic and professional roles"
        ),
        preview_image="/static/previews/harvard_preview.png",
        renderer="HarvardPDF",
    ),
    "chronological": TemplateSpec(
        id="chronological",
        name="Chronological Classic",
        description=(
            "Standard chronological resume with clean left-aligned layout, "
            "ideal for traditional industries"
        ),
        preview_image="/static/previews/chronological_preview.png",
        renderer="ChronologicalPDF",
    ),
    "modern_minimal": TemplateSpec(
        id="modern_minimal",
        name="Modern Minimal",
        description=(
            "Sleek and minimal design with thin accent lines, perfect for tech "
            "and creative roles"
        ),
        preview_image="/static/previews/modern_minimal_preview.png",
        renderer="ModernMinimalPDF",
    ),
    "executive_bold": TemplateSpec(
        id="executive_bold",
        name="Executive Bold",
        description=(
            "Commanding executive presence with bold typography, ideal for "
            "senior leadership roles"
        ),
        preview_image="/static/previews/executive_bold_preview.png",
        renderer="ExecutiveBoldPDF",
    ),
    "creative_tech": TemplateSpec(
        id="creative_tech",
        name="Creative Tech",
        description=(
            "Project-forward layout with accent colors, designed for designers "
            "and creative technologists"
        ),
        preview_image="/static/previews/creative_tech_preview.png",
        renderer="CreativeTechPDF",
    ),
    "academic_scholar": TemplateSpec(
        id="academic_scholar",
        name="Academic Scholar",
        description=(
            "Research-focused academic CV with publications, grants, and "
            "teaching sections"
        ),
        preview_image="/static/previews/academic_scholar_preview.png",
        renderer="AcademicScholarPDF",
    ),

    # ── Regional formats ──────────────────────────────────────────────────
    "europass": TemplateSpec(
        id="europass",
        name="Europass (EU)",
        description=(
            "EU-standard structure with a CEFR language table. Experience "
            "before education. Photo optional."
        ),
        preview_image="/static/previews/europass_preview.png",
        renderer="EuropassPDF",
        # Europass puts work experience BEFORE education — the inverse of the
        # historical order, which is why the dispatcher is section-driven.
        sections=(
            "header",
            "summary",
            "experience",
            "education",
            "skills",
            "languages",
            "additional",
        ),
        page_format="A4",
        region="eu",
        photo=PHOTO_OPTIONAL,
        badge="EU standard",
    ),
    "us_canada": TemplateSpec(
        id="us_canada",
        name="US / Canada Resume",
        description=(
            "No photo, no personal details, US Letter. What American and "
            "Canadian recruiters expect to see."
        ),
        preview_image="/static/previews/us_canada_preview.png",
        renderer="USCanadaPDF",
        sections=("header", "summary", "experience", "education", "skills"),
        page_format="Letter",
        region="us_ca",
        photo=PHOTO_NONE,
        # Age, nationality and marital status are protected characteristics in
        # US/Canadian hiring. Including them creates real discrimination
        # exposure for the employer reading the CV, so they are stripped at
        # render time regardless of what the extraction produced.
        suppress=("date_of_birth", "nationality", "marital_status"),
    ),
}

DEFAULT_TEMPLATE_ID = "professional"


def get_template(template_id: str) -> TemplateSpec:
    """
    Resolve a template id to its spec.

    Falls back to the default rather than raising: the previous dispatcher
    silently fell back for unknown ids, and older app builds may still send an
    id that has since been removed. Turning that into a 500 would be a
    regression.
    """
    spec = TEMPLATES.get(template_id)
    if spec is None:
        logger.warning(
            "Unknown template_id %r - falling back to %r",
            template_id,
            DEFAULT_TEMPLATE_ID,
        )
        return TEMPLATES[DEFAULT_TEMPLATE_ID]
    return spec


def list_templates() -> List[dict]:
    """
    Public template list for GET /api/templates.

    The first four keys are unchanged from the original payload, so app builds
    that predate the regional formats keep working. `region`, `photo` and
    `badge` are additive — the client matches on `region` rather than on
    hard-coded ids, so adding UK or Lebenslauf later needs no app update.
    """
    return [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "preview_image": t.preview_image,
            "region": t.region,
            "photo": t.photo,
            "badge": t.badge,
        }
        for t in TEMPLATES.values()
    ]


def accepts_photo(template_id: str) -> bool:
    """True when this format would render a supplied photo."""
    return get_template(template_id).photo != PHOTO_NONE
