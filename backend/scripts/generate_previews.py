"""
Generate preview PNG thumbnails for all CV templates.
Run from the backend/ directory:
    python scripts/generate_previews.py
"""
import os
import sys
import tempfile

# Add backend dir to path so imports work when run from backend/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

# Output goes to backend/static/previews/
PREVIEWS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "previews")
)
os.makedirs(PREVIEWS_DIR, exist_ok=True)

SAMPLE_DATA = {
    "header": {
        "name": "Alexandra Johnson",
        "email": "alex.johnson@email.com",
        "phone": "+1 (555) 234-5678",
        "linkedin": "linkedin.com/in/alexjohnson",
        "address": "New York, NY",
        "website": None,
        "job_title": "Senior Software Engineer",
    },
    "education": [
        {
            "school": "MIT",
            "degree": "B.S. Computer Science (GPA 3.9)",
            "location": "Cambridge, MA",
            "date": "Sep 2015 - May 2019",
            "bullets": ["Dean's List 2017-2019"],
        }
    ],
    "experience": [
        {
            "company": "Stripe",
            "role": "Senior Software Engineer",
            "location": "New York, NY",
            "date": "Jul 2021 - Present",
            "bullets": [
                "Reduced API latency by 38% by redesigning payment processing pipeline",
                "Shipped 12 features to 500k+ merchants in 6 months",
            ],
        },
        {
            "company": "Google",
            "role": "Software Engineer",
            "location": "Mountain View, CA",
            "date": "Jun 2019 - Jun 2021",
            "bullets": [
                "Built real-time data pipeline processing 2M events/day",
                "Improved test coverage from 62% to 91% across 3 services",
            ],
        },
    ],
    "skills": "Python, Go, TypeScript, React, PostgreSQL, Redis, Kubernetes, AWS",
    # Fields only the regional formats render. Present here so their previews
    # aren't misleadingly empty.
    "summary": (
        "Backend engineer with six years building payment infrastructure at scale."
    ),
    "languages": [
        {"language": "English", "mother_tongue": True, "listening": None,
         "reading": None, "speaking": None, "writing": None, "overall": None},
        {"language": "Spanish", "mother_tongue": False, "listening": "C1",
         "reading": "C1", "speaking": "B2", "writing": "B2", "overall": None},
        {"language": "French", "mother_tongue": False, "listening": None,
         "reading": None, "speaking": None, "writing": None, "overall": "A2"},
    ],
    "driving_licence": "B",
}


def make_preview(template_id: str, out_png: str):
    print(f"  {template_id:20} ...", end=" ", flush=True)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        from pdf2image import convert_from_path
        from PIL import Image
        from services.pdf_service import generate_improved_pdf

        # Go through the real dispatcher rather than calling section methods
        # directly. Previews that bypass it drift out of sync with actual
        # output the moment a format changes its section order — which is
        # exactly what Europass does.
        generate_improved_pdf(SAMPLE_DATA, tmp_path, template_id)

        # 96 DPI gives ~794x1123 px for A4, plenty for a thumbnail
        images = convert_from_path(tmp_path, dpi=96, first_page=1, last_page=1)
        if images:
            img = images[0]
            # Resize to thumbnail height=600 to keep files small
            ratio = 600 / img.height
            thumb = img.resize((int(img.width * ratio), 600), Image.LANCZOS)
            thumb.save(out_png, "PNG", optimize=True, compress_level=9)
            size_kb = os.path.getsize(out_png) // 1024
            print(f"OK  ({size_kb} KB)")
        else:
            print("FAILED — no pages returned")
    except Exception as e:
        print(f"FAILED: {e}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def main():
    # Driven by the registry, so a new format gets a preview automatically —
    # the filename comes from the spec's own preview_image path.
    from services.templates import TEMPLATES

    print(f"\nOutput dir: {PREVIEWS_DIR}\n")
    for template_id, spec in TEMPLATES.items():
        filename = os.path.basename(spec.preview_image)
        make_preview(template_id, os.path.join(PREVIEWS_DIR, filename))

    print("\nAll done.")


if __name__ == "__main__":
    main()
