/**
 * Picks the CV format most likely to suit the user, from their device region.
 *
 * This only ever *recommends* — the user always sees every format and can
 * override with one tap. Silently locking someone into a format because of
 * their phone's region setting would be wrong: people apply abroad.
 */

import * as Localization from "expo-localization";
import type { CVTemplate, TemplateRegion } from "@/services/resumeApi";

/** EU + EEA + Switzerland — where Europass is understood or expected. */
const EU_EEA = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  "IS", "LI", "NO", "CH",
]);

const US_CA = new Set(["US", "CA"]);

/**
 * Two-letter region of the device, e.g. "FR". Returns null rather than
 * throwing — a failure here must never break the Upload screen.
 */
export function deviceRegionCode(): string | null {
  try {
    return Localization.getLocales()?.[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

/**
 * Map a region code onto a format bucket. Returns null when we have no
 * confident opinion — in that case no format is badged, which is better than
 * recommending the wrong one.
 */
export function regionBucket(code: string | null): TemplateRegion {
  if (!code) return null;
  const upper = code.toUpperCase();
  if (US_CA.has(upper)) return "us_ca";
  if (EU_EEA.has(upper)) return "eu";
  return null;
}

export function deviceRegionBucket(): TemplateRegion {
  return regionBucket(deviceRegionCode());
}

/**
 * The template to suggest, or undefined if we have no opinion (or the backend
 * is old enough not to report `region` at all).
 *
 * Matching happens on the template's own `region` field rather than on
 * hard-coded ids, so adding UK or Lebenslauf server-side needs no app update.
 */
export function recommendedTemplate(
  templates: CVTemplate[],
  bucket: TemplateRegion = deviceRegionBucket(),
): CVTemplate | undefined {
  if (!bucket) return undefined;
  return templates.find((t) => t.region === bucket);
}

/** Recommended format first, everything else in its original order. */
export function sortByRecommendation(
  templates: CVTemplate[],
  recommended?: CVTemplate,
): CVTemplate[] {
  if (!recommended) return templates;
  return [
    recommended,
    ...templates.filter((t) => t.id !== recommended.id),
  ];
}
