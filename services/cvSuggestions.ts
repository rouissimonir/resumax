/**
 * CV completeness analyser.
 *
 * Takes the structured resume data produced by the backend and works out what
 * the candidate is still missing, so the app can nudge them toward a stronger,
 * more relevant CV (e.g. "you forgot to add an email address").
 *
 * Pure functions only — no React, no network. Easy to unit test.
 */

export type SuggestionSeverity = "critical" | "important" | "polish";

export interface CVSuggestion {
  /** Stable key, useful for lists and analytics */
  id: string;
  severity: SuggestionSeverity;
  /** Feather icon name */
  icon: string;
  title: string;
  detail: string;
}

export interface CVAnalysis {
  /** 0–100 completeness score */
  score: number;
  suggestions: CVSuggestion[];
  /** Short labels of the things the CV already does well */
  strengths: string[];
  /** True when nothing is missing */
  isComplete: boolean;
}

/** Weight of each check in the overall score. */
const WEIGHTS: Record<SuggestionSeverity, number> = {
  critical: 3,
  important: 2,
  polish: 1,
};

const WEAK_PHRASES = [
  "responsible for",
  "worked on",
  "helped with",
  "helped to",
  "in charge of",
  "duties included",
  "tasked with",
  "assisted with",
];

/** Values the AI sometimes emits when it can't find a field. */
const EMPTY_VALUES = [
  "",
  "n/a",
  "na",
  "none",
  "not found",
  "not provided",
  "not specified",
  "unknown",
  "null",
  "undefined",
  "-",
  "--",
];

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "string") return false;
  return EMPTY_VALUES.includes(value.trim().toLowerCase());
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/** `skills` may arrive as a comma-separated string or an array. */
function skillList(skills: unknown): string[] {
  if (Array.isArray(skills)) {
    return skills.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof skills === "string") {
    // Keep single-character entries — "C", "R" and "Go" are real skills.
    return skills
      .split(/[,|;•\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Collect every bullet across every experience entry. */
function allBullets(experience: any[]): string[] {
  return experience.flatMap((job) =>
    asArray<string>(job?.bullets)
      .map((b) => String(b).trim())
      .filter(Boolean),
  );
}

/**
 * Safely parse the resume payload, which is stored as a JSON string on the
 * client but may already be an object.
 */
export function parseResumeData(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function analyseCV(rawData: unknown): CVAnalysis {
  const data = parseResumeData(rawData);

  if (!data) {
    return {
      score: 0,
      suggestions: [],
      strengths: [],
      isComplete: false,
    };
  }

  const header = data.header ?? {};
  const experience = asArray<any>(data.experience);
  const education = asArray<any>(data.education);
  const skills = skillList(data.skills);
  const bullets = allBullets(experience);

  const suggestions: CVSuggestion[] = [];
  const strengths: string[] = [];
  let earned = 0;
  let total = 0;

  /** Register a check: pass → score credit + strength label, fail → suggestion. */
  const check = (
    passed: boolean,
    strengthLabel: string,
    suggestion: Omit<CVSuggestion, "severity"> & {
      severity: SuggestionSeverity;
    },
  ) => {
    total += WEIGHTS[suggestion.severity];
    if (passed) {
      earned += WEIGHTS[suggestion.severity];
      strengths.push(strengthLabel);
    } else {
      suggestions.push(suggestion);
    }
  };

  // ── Contact details ──────────────────────────────────────────────
  check(!isBlank(header.name), "Name", {
    id: "name",
    severity: "critical",
    icon: "user",
    title: "Add your full name",
    detail:
      "Your name should sit at the very top — it's the first thing a recruiter looks for.",
  });

  check(!isBlank(header.email), "Email", {
    id: "email",
    severity: "critical",
    icon: "mail",
    title: "Add your email address",
    detail:
      "Without an email, recruiters have no way to reach you. Use a professional address like firstname.lastname@gmail.com.",
  });

  check(!isBlank(header.phone), "Phone", {
    id: "phone",
    severity: "critical",
    icon: "phone",
    title: "Add your phone number",
    detail:
      "Include the country code (e.g. +216 …) so international recruiters can call you.",
  });

  check(!isBlank(header.linkedin), "LinkedIn", {
    id: "linkedin",
    severity: "important",
    icon: "linkedin",
    title: "Add your LinkedIn profile",
    detail:
      "Most recruiters check LinkedIn before replying. A profile link makes you easier to verify and trust.",
  });

  check(!isBlank(header.address), "Location", {
    id: "location",
    severity: "important",
    icon: "map-pin",
    title: "Add your city and country",
    detail:
      "Employers filter by location. City + country is enough — no need for a full street address.",
  });

  check(!isBlank(header.website), "Portfolio", {
    id: "website",
    severity: "polish",
    icon: "globe",
    title: "Add a portfolio or GitHub link",
    detail:
      "A link to your work lets recruiters see proof of your skills instead of just reading about them.",
  });

  // ── Experience ───────────────────────────────────────────────────
  check(experience.length > 0, "Work experience", {
    id: "experience-missing",
    severity: "critical",
    icon: "briefcase",
    title: "Add your work experience",
    detail:
      "Include at least one role with the company name, your job title and the dates you worked there.",
  });

  if (experience.length > 0) {
    const missingDates = experience.filter((job) => isBlank(job?.date)).length;
    check(missingDates === 0, "Dates on every role", {
      id: "experience-dates",
      severity: "important",
      icon: "calendar",
      title:
        missingDates === 1
          ? "Add dates to 1 role"
          : `Add dates to ${missingDates} roles`,
      detail:
        "Recruiters scan for career gaps. Use one consistent format throughout, such as 03/2021 – Present.",
    });

    const missingRole = experience.filter((job) => isBlank(job?.role)).length;
    check(missingRole === 0, "Job titles", {
      id: "experience-roles",
      severity: "important",
      icon: "award",
      title: "Add your job title to every role",
      detail:
        "Job titles are one of the main things Applicant Tracking Systems match against a vacancy.",
    });

    check(bullets.length > 0, "Achievement bullets", {
      id: "bullets-missing",
      severity: "critical",
      icon: "list",
      title: "Describe what you did in each role",
      detail:
        "Add 3–6 short bullet points per position, each starting with an action verb like Led, Built or Reduced.",
    });

    if (bullets.length > 0) {
      // Quantified impact — bullets containing a number, %, or currency.
      const quantified = bullets.filter((b) =>
        /\d|%|\$|€|£/.test(b),
      ).length;
      const quantifiedRatio = quantified / bullets.length;
      check(quantifiedRatio >= 0.4, "Measurable results", {
        id: "bullets-metrics",
        severity: "important",
        icon: "trending-up",
        title: "Add numbers to your achievements",
        detail:
          "Only " +
          Math.round(quantifiedRatio * 100) +
          "% of your bullets contain a measurable result. Swap “improved performance” for “cut load time by 40%”.",
      });

      // Weak, passive phrasing.
      const weak = bullets.filter((b) =>
        WEAK_PHRASES.some((p) => b.toLowerCase().includes(p)),
      );
      check(weak.length === 0, "Strong action verbs", {
        id: "bullets-weak-verbs",
        severity: "polish",
        icon: "zap",
        title:
          weak.length === 1
            ? "Rewrite 1 weak bullet"
            : `Rewrite ${weak.length} weak bullets`,
        detail:
          "Phrases like “responsible for” describe duties, not impact. Start with a strong verb instead: Led, Designed, Automated.",
      });

      // Thin roles — fewer than 2 bullets.
      const thinRoles = experience.filter(
        (job) => asArray<string>(job?.bullets).length < 2,
      ).length;
      check(thinRoles === 0, "Well-described roles", {
        id: "bullets-thin",
        severity: "polish",
        icon: "edit-3",
        title:
          thinRoles === 1
            ? "1 role needs more detail"
            : `${thinRoles} roles need more detail`,
        detail:
          "Roles with a single bullet look unfinished. Aim for 3–6 bullets on your most recent positions.",
      });
    }
  }

  // ── Education & skills ───────────────────────────────────────────
  check(education.length > 0, "Education", {
    id: "education-missing",
    severity: "important",
    icon: "book-open",
    title: "Add your education",
    detail:
      "List your degree, institution and graduation year. Many ATS filters require an education section.",
  });

  check(skills.length >= 5, "Skills", {
    id: "skills",
    severity: "important",
    icon: "tool",
    title:
      skills.length === 0
        ? "Add a skills section"
        : "Add more skills (you have " + skills.length + ")",
    detail:
      "Aim for 8–12 skills that mirror the wording of the job posting — this is what keyword matching scores against.",
  });

  const score = total === 0 ? 0 : Math.round((earned / total) * 100);

  // Show the most serious items first.
  const order: Record<SuggestionSeverity, number> = {
    critical: 0,
    important: 1,
    polish: 2,
  };
  suggestions.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    score,
    suggestions,
    strengths,
    isComplete: suggestions.length === 0,
  };
}

/** Headline copy shown next to the score. */
export function scoreLabel(score: number): string {
  if (score >= 95) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 60) return "Good start";
  if (score >= 40) return "Needs work";
  return "Incomplete";
}
