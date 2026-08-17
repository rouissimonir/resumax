import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * CV generation preferences.
 *
 * Collected during onboarding (all skippable) and editable afterwards in
 * ProfileScreen. Every field has an "unset" value that reproduces the app's
 * previous behaviour exactly, so an account that skips onboarding — or an
 * existing install upgrading into this build — is unaffected.
 */

export type CvLanguage = "auto" | "en" | "fr";
export type ExperienceLevel = "" | "student" | "junior" | "mid" | "senior";

export type Preferences = {
  /** "auto" lets the backend detect the language from the CV's prose. */
  cvLanguage: CvLanguage;
  /** "" means "recommend from device region" (see services/regionFormat.ts). */
  preferredFormat: string;
  /** Free text, e.g. "Java Backend Developer, fintech". */
  targetRole: string;
  experienceLevel: ExperienceLevel;
};

export const DEFAULT_PREFERENCES: Preferences = {
  cvLanguage: "auto",
  preferredFormat: "",
  targetRole: "",
  experienceLevel: "",
};

const STORAGE_KEY = "CV_PREFERENCES";

type PreferencesContextType = {
  preferences: Preferences;
  /** Merge a partial update and persist it. */
  updatePreferences: (updates: Partial<Preferences>) => void;
  resetPreferences: () => void;
  /** False until AsyncStorage has been read, so screens don't flash defaults. */
  isLoaded: boolean;
};

const PreferencesContext = createContext<PreferencesContextType | undefined>(
  undefined,
);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        // Spread over the defaults rather than replacing: a build that adds a
        // new preference must not read `undefined` for it on existing installs.
        setPreferences({ ...DEFAULT_PREFERENCES, ...JSON.parse(stored) });
      }
    } catch (e) {
      // A corrupt or unreadable store must not block the app — fall back to
      // defaults, which are the same as having skipped onboarding.
      console.error("Failed to load CV preferences", e);
    } finally {
      setIsLoaded(true);
    }
  };

  const updatePreferences = async (updates: Partial<Preferences>) => {
    const next = { ...preferences, ...updates };
    setPreferences(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error("Failed to save CV preferences", e);
    }
  };

  const resetPreferences = async () => {
    setPreferences(DEFAULT_PREFERENCES);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error("Failed to reset CV preferences", e);
    }
  };

  return (
    <PreferencesContext.Provider
      value={{ preferences, updatePreferences, resetPreferences, isLoaded }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error(
      "usePreferences must be used within a PreferencesProvider",
    );
  }
  return context;
}

// ── Option lists, shared by OnboardingScreen and ProfileScreen ────────────
// Defined once so the two screens can never drift out of sync.

export const LANGUAGE_OPTIONS: { value: CvLanguage; label: string; hint?: string }[] =
  [
    { value: "auto", label: "Detect automatically", hint: "Recommended" },
    { value: "en", label: "English" },
    { value: "fr", label: "Français" },
  ];

export const EXPERIENCE_OPTIONS: {
  value: ExperienceLevel;
  label: string;
}[] = [
  { value: "", label: "Not specified" },
  { value: "student", label: "Student / Intern" },
  { value: "junior", label: "Junior (0–2 yrs)" },
  { value: "mid", label: "Mid-level (3–7 yrs)" },
  { value: "senior", label: "Senior (8+ yrs)" },
];
