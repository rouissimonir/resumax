import { Platform, StyleSheet } from "react-native";

/**
 * Design system — refined minimal.
 *
 * Principles:
 *  · Neutral-first. Colour is used to mean something (success, error), never
 *    for decoration. There is no second brand colour competing for attention.
 *  · Structure comes from hairline borders and background layers, not from
 *    drop shadows and glows.
 *  · One type scale with real hierarchy — large text gets tighter tracking.
 *  · Motion is short and functional. Nothing loops or pulses on its own.
 *
 * Every token that existed before is still exported, so screens that have not
 * been reworked yet keep rendering correctly.
 */

// ── Colour ────────────────────────────────────────────────────────────
//
// A neutral (zinc) ramp carries the whole interface. `primary` is a deep
// near-black used for solid fills and emphasis — white text always sits on it
// legibly in both schemes.

export const Colors = {
  light: {
    text: "#09090B",
    textSecondary: "#52525B",
    // Kept at 4.8:1 on white — tertiary text still has to be readable.
    textMuted: "#71717A",
    buttonText: "#FFFFFF",

    tabIconDefault: "#A1A1AA",
    tabIconSelected: "#09090B",
    link: "#09090B",

    primary: "#18181B",
    primaryLight: "#3F3F46",
    primaryDark: "#09090B",

    backgroundRoot: "#FAFAFA",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F4F4F5",
    backgroundTertiary: "#E4E4E7",

    border: "#E4E4E7",
    borderLight: "#F1F1F3",

    // Semantic — muted, print-like, never neon.
    success: "#15803D",
    successLight: "#DCFCE7",
    error: "#B91C1C",
    errorLight: "#FEE2E2",
    warning: "#B45309",
    warningLight: "#FEF3C7",

    // Kept for compatibility. Both now resolve to the same restrained tone.
    accent: "#3F3F46",
    accentLight: "#E4E4E7",
    gold: "#B45309",
    goldLight: "#FEF3C7",

    cardGlow: "transparent",
  },
  dark: {
    text: "#FAFAFA",
    textSecondary: "#A1A1AA",
    // 4.6:1 on the card surface.
    textMuted: "#7E7E88",
    buttonText: "#FFFFFF",

    tabIconDefault: "#71717A",
    tabIconSelected: "#FAFAFA",
    link: "#FAFAFA",

    primary: "#4A4A55",
    primaryLight: "#71717A",
    primaryDark: "#27272A",

    backgroundRoot: "#09090B",
    backgroundDefault: "#141417",
    backgroundSecondary: "#1C1C20",
    backgroundTertiary: "#27272A",

    border: "#27272A",
    borderLight: "#1F1F23",

    success: "#4ADE80",
    successLight: "#14311F",
    error: "#F87171",
    errorLight: "#3B1414",
    warning: "#FBBF24",
    warningLight: "#3A2A0A",

    accent: "#A1A1AA",
    accentLight: "#27272A",
    gold: "#FBBF24",
    goldLight: "#3A2A0A",

    cardGlow: "transparent",
  },
};

// ── Spacing ───────────────────────────────────────────────────────────
// Strict 4pt grid.

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 64,
  "5xl": 80,
  inputHeight: 48,
  buttonHeight: 48,
};

// ── Radius ────────────────────────────────────────────────────────────
// Tightened considerably. Oversized pill-shaped cards are the fastest way to
// make an interface look templated.

export const BorderRadius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  "2xl": 24,
  "3xl": 28,
  full: 9999,
};

// ── Type ──────────────────────────────────────────────────────────────
// Optical tracking: the larger the text, the tighter the letter spacing.

export const Typography = {
  hero: {
    fontSize: 30,
    fontWeight: "700" as const,
    letterSpacing: -0.7,
    lineHeight: 36,
  },
  h1: {
    fontSize: 24,
    fontWeight: "700" as const,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  h2: {
    fontSize: 19,
    fontWeight: "600" as const,
    letterSpacing: -0.3,
    lineHeight: 25,
  },
  h3: {
    fontSize: 16,
    fontWeight: "600" as const,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  h4: {
    fontSize: 14,
    fontWeight: "600" as const,
    letterSpacing: -0.1,
    lineHeight: 19,
  },
  body: {
    fontSize: 15,
    fontWeight: "400" as const,
    lineHeight: 22,
  },
  bodySmall: {
    fontSize: 13,
    fontWeight: "400" as const,
    lineHeight: 19,
  },
  caption: {
    fontSize: 12,
    fontWeight: "500" as const,
    lineHeight: 16,
  },
  small: {
    fontSize: 11,
    fontWeight: "400" as const,
    lineHeight: 15,
  },
  button: {
    fontSize: 15,
    fontWeight: "600" as const,
    letterSpacing: -0.1,
  },
  link: {
    fontSize: 15,
    fontWeight: "500" as const,
  },
  /** Small all-caps label for section eyebrows. */
  overline: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
  },
  /** Tabular-ish figures for scores and counts. */
  numeric: {
    fontSize: 26,
    fontWeight: "700" as const,
    letterSpacing: -0.8,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "system-ui, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

// ── Gradients ─────────────────────────────────────────────────────────
// Deliberately near-flat. Kept as an export because several screens still
// render LinearGradient fills; they now read as solid, intentional colour.

export const Gradients = {
  light: {
    primary: ["#18181B", "#1F1F23"] as const,
    primarySoft: ["#F4F4F5", "#FAFAFA"] as const,
    secondary: ["#3F3F46", "#52525B"] as const,
    accent: ["#3F3F46", "#52525B"] as const,
    success: ["#15803D", "#166534"] as const,
    background: ["#FAFAFA", "#F4F4F5"] as const,
    card: ["#FFFFFF", "#FFFFFF"] as const,
    premium: ["#27272A", "#18181B"] as const,
    glass: ["rgba(255,255,255,0.92)", "rgba(255,255,255,0.82)"] as const,
  },
  dark: {
    primary: ["#4A4A55", "#3F3F46"] as const,
    primarySoft: ["#1C1C20", "#141417"] as const,
    secondary: ["#52525B", "#3F3F46"] as const,
    accent: ["#52525B", "#3F3F46"] as const,
    success: ["#15803D", "#14532D"] as const,
    background: ["#09090B", "#141417"] as const,
    card: ["#141417", "#141417"] as const,
    premium: ["#27272A", "#1C1C20"] as const,
    glass: ["rgba(20,20,23,0.92)", "rgba(20,20,23,0.82)"] as const,
  },
};

// ── Elevation ─────────────────────────────────────────────────────────
// Shadows are a last resort here — surfaces are separated by borders and
// background steps. What remains is barely-there, and neutral (never tinted).

export const Shadows = {
  none: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  small: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  large: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 4,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  // Previously coloured glows. Now neutral so nothing halos.
  glow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  glowSuccess: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
};

// ── Motion ────────────────────────────────────────────────────────────
// Short and purposeful. The spring is damped enough not to wobble.

export const Animations = {
  instant: 90,
  fast: 140,
  normal: 190,
  slow: 260,
  verySlow: 340,
  spring: {
    damping: 22,
    stiffness: 220,
    mass: 0.6,
  },
};

export const Glassmorphism = {
  blur: 18,
  opacity: 0.92,
  borderOpacity: 0.08,
};

/** Standard press feedback — subtle, no scale bounce on plain rows. */
export const PressedOpacity = 0.62;

/** Thinnest rule the display can draw — used for dividers between rows. */
export const Hairline = StyleSheet.hairlineWidth;
