import os
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor
# NOTE: extraction is deliberately format-independent. /api/generate-pdf
# re-renders from the stored JSON without calling the model again, so if the
# prompt varied by template the languages section would vanish the moment a
# user switched format. The renderer decides what to display; this file always
# extracts the maximal document.

# Thread pool for running blocking Gemini API calls
_executor = ThreadPoolExecutor(max_workers=4)

logger = logging.getLogger(__name__)

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    logger.warning("GEMINI_API_KEY not found in environment variables")

SYSTEM_PROMPT = """You are an expert resume improvement assistant specialized in creating ATS-optimized, professional resumes.

CRITICAL FORMATTING REQUIREMENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ATS OPTIMIZATION RULES (MUST FOLLOW):
1. Use ONLY standard fonts: Arial, Calibri, Helvetica, Times New Roman
2. NO photos, graphics, tables, text boxes, icons, or fancy fonts
3. Use simple text formatting with clear section headings
4. Reverse-chronological order (most recent first)
5. Include quantifiable achievements with metrics
6. Use strong action verbs
7. Keep sections clearly separated with visual dividers

RECRUITER PREFERENCES:
• Recruiters spend 6-10 seconds scanning resumes
• Clean layout with clear section headings
• Easy-to-locate information
• Career trajectory must be immediately visible

REQUIRED OUTPUT STRUCTURE ( only add if icluded in original resume )):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR FULL NAME
Target Job Title
City, Country | Phone | Email | linkedin.com/in/yourprofile

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROFESSIONAL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3-4 sentences: professional identity + years of experience + top achievement with metrics + key skills]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORK EXPERIENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Job Title | Company Name | Location | MM/YYYY - MM/YYYY
• [Action verb] + [what you did] + [result with number]
• [Action verb] + [what you did] + [result with number]
• [Action verb] + [what you did] + [result with number]

Previous Job Title | Company | Location | MM/YYYY - MM/YYYY
• [Achievement bullet with quantified impact]
• [Achievement bullet with quantified impact]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EDUCATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Degree, Major | University Name | Graduation Date

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Skill 1 | Skill 2 | Skill 3 | Skill 4 | Skill 5 | Skill 6

IMPROVEMENT GUIDELINES:
1. Preserve all factual information (names, dates, companies, education)
2. Use strong action verbs (Led, Developed, Achieved, Increased, etc.)
3. Quantify all achievements with numbers, percentages, or metrics
4. Improve clarity and conciseness
5. Maintain professional tone
6. Optimize for Applicant Tracking Systems (ATS)
7. Remove redundancies and filler words
8. Highlight key accomplishments with measurable impact
9. Use consistent formatting throughout
10. Ensure each bullet starts with an action verb

FORMATTING SPECIFICATIONS:
• Font Size: 10-12pt for body text
• Headings: 12-14pt, bold
• Margins: 0.5-1 inch
• Use pipe separators (|) not slashes or commas
• Section dividers: Use the exact line pattern shown above
• Date format: MM/YYYY - MM/YYYY or MM/YYYY - Present

WHAT TO AVOID:
❌ Photos or headshots
❌ Graphics, charts, or icons
❌ Tables or text boxes
❌ Multiple columns (complex layouts)
❌ Fancy fonts or colors
❌ Weak verbs (helped, worked on, responsible for)
❌ Vague statements without metrics
❌ Personal pronouns (I, me, my)
❌ Abbreviations without context

Return ONLY the improved resume text following the EXACT structure above with section dividers."""

import json

# ── Post-parse validation ─────────────────────────────────────────────────
#
# Everything below exists because prompt rules are a soft control. The model
# will occasionally invent a CEFR level, or return "Not specified" where it was
# asked for null. Dropping an unverifiable value is always safer than passing it
# through to a document a recruiter will read.

_CEFR_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}

# Values models emit when they mean "absent".
_NULLISH = {
    "", "n/a", "na", "none", "null", "not found", "not provided",
    "not specified", "not stated", "unknown", "-", "--", "tbd",
}


def _nullify(value):
    """Collapse the model's many ways of saying 'nothing' into None."""
    if value is None:
        return None
    if isinstance(value, str):
        if value.strip().lower() in _NULLISH:
            return None
        return value.strip()
    return value


def _cefr(value):
    """Return a CEFR code only if the model actually produced one."""
    if value is None:
        return None
    code = str(value).strip().upper()
    return code if code in _CEFR_LEVELS else None


def _normalize_languages(raw):
    """
    Keep only entries with a real language name, and only levels that are valid
    CEFR codes. Anything else is dropped rather than guessed at.
    """
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:8]:                      # a CV listing 9+ languages is noise
        if not isinstance(item, dict):
            continue
        name = _nullify(item.get("language"))
        if not name:
            continue
        out.append({
            "language": name,
            "mother_tongue": bool(item.get("mother_tongue")),
            "listening": _cefr(item.get("listening")),
            "reading": _cefr(item.get("reading")),
            "speaking": _cefr(item.get("speaking")),
            "writing": _cefr(item.get("writing")),
            "overall": _cefr(item.get("overall")),
        })
    return out


# ─────────────────────────────────────────────────────────────
# LANGUAGE
# ─────────────────────────────────────────────────────────────
#
# Detection is the model's job: it reads the whole document anyway, and a
# statistical detector is unreliable on exactly this input — a French CV is
# dense with English technical nouns ("Spring Boot", "Full-Stack",
# "microservices") and the bullets are short. The stopword count below exists
# only as a fallback for when the model omits the field.

SUPPORTED_LANGUAGES = ("en", "fr")
DEFAULT_LANGUAGE = "en"

_STOPWORDS = {
    "fr": {
        "et", "de", "des", "les", "la", "le", "un", "une", "du", "en", "pour",
        "avec", "dans", "sur", "par", "au", "aux", "ans", "chez", "afin",
        "ainsi", "entre", "plus", "ses", "son", "sa", "leur", "est", "sont",
    },
    "en": {
        "and", "the", "of", "for", "with", "in", "on", "by", "to", "at",
        "from", "years", "a", "an", "as", "was", "were", "is", "are", "their",
    },
}


def detect_language(text: str) -> str:
    """
    Fallback language detection by stopword frequency.

    Only ever consulted when the model did not return a usable language. Ties
    and empty input resolve to English rather than raising: a CV rendered with
    English headings is a cosmetic problem, a 500 is not.
    """
    if not text:
        return DEFAULT_LANGUAGE

    words = re.findall(r"[a-zà-öø-ÿ]+", text.lower())
    if not words:
        return DEFAULT_LANGUAGE

    counts = {lang: sum(w in stops for w in words) for lang, stops in _STOPWORDS.items()}
    best = max(counts, key=counts.get)
    return best if counts[best] else DEFAULT_LANGUAGE


def resolve_language(model_value, original_text: str, preference: str = None) -> str:
    """
    Decide the CV language from, in order: an explicit user preference, the
    model's own reading of the document, then stopword counting.
    """
    if preference and preference.lower() in SUPPORTED_LANGUAGES:
        return preference.lower()

    if isinstance(model_value, str) and model_value.strip():
        code = model_value.strip().lower()[:2]
        if code in SUPPORTED_LANGUAGES:
            return code
        # The model read the document and named a language we have no label
        # table for. Trust that reading and fall back to English headings —
        # do NOT re-guess with the stopword counter, which only knows en/fr
        # and would mislabel. Spanish in particular shares "de", "en", "la",
        # "un", "son" and "entre" with French and scores as French.
        logger.info(
            "CV language '%s' has no label table; using '%s' headings. "
            "The CV's own text is unaffected.", code, DEFAULT_LANGUAGE,
        )
        return DEFAULT_LANGUAGE

    detected = detect_language(original_text)
    logger.info("Language not supplied by model; stopword fallback chose '%s'.", detected)
    return detected


def normalize_extraction(data: dict) -> dict:
    """Clean the model's JSON so downstream renderers can trust its shape."""
    if not isinstance(data, dict):
        return {}

    header = data.get("header")
    if isinstance(header, dict):
        for key in (
            "name", "email", "phone", "linkedin", "address", "website",
            "job_title", "date_of_birth", "nationality",
        ):
            if key in header:
                header[key] = _nullify(header[key])
    else:
        data["header"] = {}

    data["summary"] = _nullify(data.get("summary"))
    data["driving_licence"] = _nullify(data.get("driving_licence"))
    data["languages"] = _normalize_languages(data.get("languages"))

    for key in ("education", "experience"):
        if not isinstance(data.get(key), list):
            data[key] = []

    return data


def _preference_rules(target_role: str = None, experience_level: str = None,
                      language: str = None) -> str:
    """
    Render the user's saved preferences as prompt rules. Returns "" when nothing
    is set, so an unconfigured account produces the exact prompt it did before.
    """
    rules = []
    if target_role:
        rules.append(
            f'- The candidate is targeting: "{target_role}". Where the source text '
            "supports it, prefer wording and keywords relevant to that role so the CV "
            "reads well to an ATS screening for it. This is a matter of EMPHASIS ONLY: "
            "never add a skill, tool or responsibility the candidate did not write."
        )
    if experience_level:
        rules.append(
            f'- Career stage: "{experience_level}". Pitch the summary and bullet '
            "emphasis accordingly. Do not invent seniority the source does not show."
        )
    if language:
        rules.append(
            f'- Write the improved content in "{language}". The source is already in '
            "this language; do NOT translate it, simply keep it consistent."
        )
    if not rules:
        return ""
    return "USER PREFERENCES (emphasis only — they never override the integrity rules):\n" + "\n".join(rules) + "\n"


async def improve_resume_text(
    original_text: str,
    file_id: str = None,
    template_id: str = "professional",
    target_role: str = None,
    experience_level: str = None,
    language: str = None,
) -> dict:
    logger.info("=" * 80)
    logger.info("STARTING RESUME IMPROVEMENT PROCESS")
    logger.info("=" * 80)
    logger.info(f"File ID: {file_id}")
    logger.info(f"Template ID: {template_id}")
    
    try:
        model_name = os.getenv("LLM_MODEL", "gemini-1.5-flash")
        logger.info(f"Using model: {model_name}")

        # Pre-process: Extract contact info using regex (more reliable than LLM for messy OCR)
        import re
        
        # 1. Extract Email
        emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', original_text)
        detected_email = emails[0] if emails else "Not found"
        
        # 2. Extract Phone (various formats)
        phones = re.findall(r'(?:\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}', original_text)
        detected_phone = phones[0] if phones else "Not found"
        
        # 3. Clean OCR garbage (icons misread as text)
        clean_text = original_text
        garbage_patterns = [
            r'/envel[^\s]*?(?=[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-])', # Specific prefix for email
            r'/envel[^\s]{0,5}', # General prefix
            r'/h[^\s]*?me', r'/linked[^\s]*?', r'/github[^\s]*?', 
            r'♂', r'♀', r'¶', r'⌢', r'|', r'\(cid:\d+\)',
            r'^\s*pe\s*(?=[a-zA-Z0-9._%+-]+@)', # Rogue 'pe' before email
        ]
        for pattern in garbage_patterns:
            clean_text = re.sub(pattern, '', clean_text)
        
        # Additional surgical fix for the "perouissi" case
        if detected_email != "Not found":
            # If the email in the text starts with 'pe' + the detected email, strip 'pe'
            pe_version = "pe" + detected_email
            if pe_version in clean_text:
                clean_text = clean_text.replace(pe_version, detected_email)

        logger.info(f"Detected Email: {detected_email}")
        logger.info(f"Detected Phone: {detected_phone}")

        prompt = f"""
        You are an expert Resume Writer.
        1. Parse the following resume text.
        2. EXTRACT CONTACT INFO EXACTLY: Do not change email, phone, or address.
        3. IMPROVE the content: Use strong action verbs, quantify results, fix grammar.

        TEXT REPAIR RULES (the source text came from a PDF and may be damaged):
        - The extractor scatters word boundaries. Repair split and merged words:
          "exp érience" -> "expérience", "implémentédes" -> "implémenté des",
          "syst èmes distribu és" -> "systèmes distribués", "z éroun" -> "zéro un".
        - Fix ONLY spacing/word-boundary damage this way. Repairing a broken word
          is not the same as changing it: never swap in a different word, and never
          alter names, companies, emails, URLs or dates while repairing.
        - If a word is already correct, leave it exactly as it is.

        CONTENT INTEGRITY RULES (CRITICAL — NEVER VIOLATE):
        - NEVER invent metrics, numbers, or percentages that are not in the original text.
          Only quantify with figures the candidate actually wrote. If a bullet has no
          number, improve the wording WITHOUT adding a fake number.
        - NEVER add skills, employers, degrees, certifications, or dates not in the source.
        - NEVER change dates, job titles, company names, or contact details.
        - Keep the resume in its ORIGINAL LANGUAGE (do not translate).
        - Order experience and education reverse-chronologically (most recent first).

        STYLE RULES:
        - Every bullet starts with a strong action verb (Led, Designed, Reduced, Automated).
        - No personal pronouns (I, me, my) and no weak phrases ("responsible for", "helped with").
        - Keep each bullet to at most 2 lines; 3-6 bullets per role.
        - Present tense for the current role, past tense for previous roles.
        - One consistent date format throughout.

        4. Return a JSON Object with this exact schema:
        {{
            "language": "en",
            "header": {{ "name": "...", "email": "...", "phone": "...", "linkedin": "...", "address": "...", "website": "...",
                        "job_title": null, "date_of_birth": null, "nationality": null }},
            "summary": null,
            "education": [ {{ "school": "...", "degree": "...", "location": "...", "date": "..." }} ],
            "experience": [ {{ "company": "...", "role": "...", "location": "...", "date": "...", "bullets": ["...", "..."] }} ],
            "skills": "Skill 1, Skill 2, Skill 3",
            "languages": [ {{ "language": "...", "mother_tongue": false, "listening": null, "reading": null,
                             "speaking": null, "writing": null, "overall": null }} ],
            "driving_licence": null
        }}

        LANGUAGE FIELD:
        - "language": the ISO 639-1 code of the language the CV PROSE is written in
          ("fr" for French, "en" for English). Judge by the sentences the candidate
          wrote, NOT by technical terms. A French CV mentioning "Spring Boot",
          "microservices" and "Full-Stack" is still "fr".
        - This selects the language of the section headings in the generated PDF, so
          it must match the prose. Do not translate the CV itself.

        OPTIONAL FIELDS — EXTRACT ONLY, NEVER INFER:
        These exist because some countries expect them. They must reflect the source
        document exactly. An invented date of birth or nationality on a resume creates
        real legal exposure for the employer who reads it.
        - languages: include a language ONLY if the CV explicitly lists it under a
          languages section (Languages / Langues / Sprachen / Idiomas / Lingue / Talen
          or equivalent). Do NOT infer languages from the language the CV is written in,
          from the candidate's nationality, from their address, or from country names
          appearing anywhere in the document. If there is no languages section at all,
          return "languages": [].
        - CEFR levels: copy a level ONLY if the source states a CEFR code (A1 A2 B1 B2
          C1 C2) or an unambiguous equivalent. Map: "native"/"mother tongue" ->
          mother_tongue true with all level fields null; "fluent"/"advanced" -> C1;
          "upper intermediate" -> B2; "intermediate" -> B1; "basic"/"elementary" -> A2;
          "beginner" -> A1. If the source gives ONE overall level, put it in "overall"
          and leave listening, reading, speaking and writing null.
          NEVER guess per-skill levels the source did not state.
        - date_of_birth, nationality, driving_licence: include ONLY if explicitly
          written in the source. Otherwise null. Never derive nationality from an
          address, a name, or the language of the document.
        - job_title: the candidate's current or target title, only if the CV states one.
        - summary: if the CV already has a Profile / Summary / Objective / Profil
          section, tighten its wording. If it has none, return null.
          NEVER write a summary from scratch.

        {_preference_rules(target_role, experience_level, language)}
        CRITICAL CONTACT INFO HINTS (Use these exactly if they look correct):
        - Email Hint: {detected_email}
        - Phone Hint: {detected_phone}
        
        HINT RULES:
        - If the Email Hint is "Not found", look at the RAW TEXT carefully.
        - If you see "/envel" or "pe" or other symbols attached to an email, STRIP them.
        
        RAW TEXT:
        {clean_text}
        """

        # Choose the provider based on model name
        if "llama" in model_name.lower():
            logger.info("Using GROQ/LLAMA Provider")
            from groq import Groq
            client = Groq(api_key=os.getenv("GROQ_API_KEY"))
            
            # Groq is sync, run in executor
            loop = asyncio.get_event_loop()
            chat_completion = await loop.run_in_executor(
                _executor, 
                lambda: client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model=model_name,
                    response_format={"type": "json_object"},
                    temperature=0.0
                )
            )
            response_text = chat_completion.choices[0].message.content
            
        else:
            logger.info("Using GOOGLE/GEMINI Provider")
            api_key = os.getenv("GEMINI_API_KEY", "")
            if not api_key:
                logger.error("✗ GEMINI_API_KEY NOT FOUND!")
                return {"header": {"name": "Simulation User"}, "skills": "Error: No API Key"}

            model = genai.GenerativeModel(
                model_name=model_name,
                generation_config={
                    "temperature": 0.0,
                    "response_mime_type": "application/json",
                }
            )
            
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _executor, model.generate_content, prompt
            )
            response_text = response.text

        logger.info("✓ Received response from AI")
        
        # Parse JSON
        try:
            import json_repair
            data = json_repair.loads(response_text)
            logger.info("✓ JSON parsed successfully with json_repair")
        except Exception as e:
            logger.error(f"✗ JSON parsing failed: {str(e)}")
            logger.error(f"Raw response: {response_text[:500]}...")
            raise ValueError(f"Failed to parse AI response: {str(e)}")

        # Validate the optional fields the model was asked for. The prompt rules
        # are the first control; this is the second. Models disobey occasionally,
        # and an invented CEFR level or nationality is worse than a missing one.
        data = normalize_extraction(data)

        # Resolve once, here, and persist it on the payload. main.py writes this
        # dict to {file_id}_debug.json, so a later re-render into a different
        # format reuses the same language instead of re-deciding it and
        # producing English headings the second time round.
        data["language"] = resolve_language(data.get("language"), original_text, language)
        logger.info("CV language resolved to '%s'", data["language"])

        # NOTE: main.py persists {file_id}_debug.json, which is what
        # /api/generate-pdf reloads to re-render in a different format. The old
        # duplicate write to {file_id}_data.json was removed — it wrote the same
        # content to a relative path that breaks unless the server is launched
        # from the repo root, and nothing ever read it.

        return data

    except Exception as e:
        logger.error(f"✗ AI SERVICE ERROR: {str(e)}", exc_info=True)
        raise

def save_improvement_analysis(original_text: str, improved_text: str, suggestions: str, file_id: str):
    """Save improvement analysis and suggestions to a file."""
    try:
        output_path = f"backend/outputs/{file_id}_improvements.txt"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("RESUME IMPROVEMENT ANALYSIS\n")
            f.write(f"File ID: {file_id}\n")
            f.write("=" * 80 + "\n\n")
            
            f.write("IMPROVEMENTS MADE:\n")
            f.write("-" * 80 + "\n")
            f.write(suggestions + "\n\n")
            
            f.write("=" * 80 + "\n")
            f.write("ORIGINAL TEXT\n")
            f.write("=" * 80 + "\n")
            f.write(original_text + "\n\n")
            
            f.write("=" * 80 + "\n")
            f.write("IMPROVED TEXT\n")
            f.write("=" * 80 + "\n")
            f.write(improved_text + "\n")
        
        logger.info(f"Improvement analysis saved to: {output_path}")
    except Exception as e:
        logger.error(f"Error saving improvement analysis: {str(e)}")


def simulate_improvement(text: str) -> str:
    logger.info("Running simulated improvement")
    lines = text.split('\n')
    improved_lines = []
    
    for line in lines:
        if not line.strip():
            improved_lines.append(line)
            continue
        
        improved_line = line
        
        replacements = {
            'responsible for': 'led',
            'worked on': 'developed',
            'helped': 'contributed to',
            'did': 'executed',
            'made': 'created',
            'used': 'utilized',
            'good': 'strong',
            'very': '',
        }
        
        for old, new in replacements.items():
            improved_line = improved_line.replace(old, new)
            improved_line = improved_line.replace(old.capitalize(), new.capitalize())
        
        improved_lines.append(improved_line)
    
    return '\n'.join(improved_lines)
