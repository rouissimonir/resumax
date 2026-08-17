import React from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import {
  usePreferences,
  LANGUAGE_OPTIONS,
  EXPERIENCE_OPTIONS,
  Preferences,
} from "@/contexts/PreferencesContext";

/**
 * The CV preference questions.
 *
 * Deliberately one component shared by OnboardingScreen (dark) and
 * ProfileScreen (light) rather than two copies: the option lists and the
 * wording are the contract with the backend, and two copies drift.
 */

type Props = {
  /** Onboarding renders on a dark gradient; ProfileScreen on the app surface. */
  dark?: boolean;
  /** Format choices from the API. Omit to hide the format question entirely. */
  templates?: { id: string; name: string; badge?: string | null }[];
  /** Rendered inside its own ScrollView when true. */
  scroll?: boolean;
};

export default function CvPreferencesForm({
  dark = false,
  templates,
  scroll = true,
}: Props) {
  const { preferences, updatePreferences } = usePreferences();
  const c = dark ? darkColors : lightColors;

  const Chip = ({
    label,
    selected,
    onPress,
    hint,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
    hint?: string;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.chip,
        { borderColor: c.chipBorder, backgroundColor: c.chipBg },
        selected && { borderColor: c.accent, backgroundColor: c.chipBgActive },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? c.accent : c.text }]}>
        {label}
      </Text>
      {hint ? (
        <Text style={[styles.chipHint, { color: c.muted }]}>{hint}</Text>
      ) : null}
    </TouchableOpacity>
  );

  const Question = ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) => (
    <View style={styles.question}>
      <Text style={[styles.questionTitle, { color: c.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.questionSubtitle, { color: c.muted }]}>
          {subtitle}
        </Text>
      ) : null}
      <View style={styles.chipRow}>{children}</View>
    </View>
  );

  const set = (updates: Partial<Preferences>) => updatePreferences(updates);

  const body = (
    <View>
      <Question
        title="What language are your CVs in?"
        subtitle="Section headings are written in this language. Auto-detect reads it from the CV itself."
      >
        {LANGUAGE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            hint={opt.hint}
            selected={preferences.cvLanguage === opt.value}
            onPress={() => set({ cvLanguage: opt.value })}
          />
        ))}
      </Question>

      {/* Stated up front rather than discovered after generating: translated
          headings exist for English and French only. Everything else still
          works — the CV keeps its own language — but the headings come out in
          English, and that is better known before the first upload. */}
      <View style={[styles.note, { borderColor: c.chipBorder, backgroundColor: c.chipBg }]}>
        <Text style={[styles.noteText, { color: c.muted }]}>
          Translated section headings are available in English and French. CVs in
          other languages are still fully supported — your text keeps its own
          language — but headings will be in English.
        </Text>
        <Text style={[styles.noteText, { color: c.muted, marginTop: 6 }]}>
          Chinese, Japanese and Korean are not supported yet, and Arabic and
          Hebrew are not displayed correctly.
        </Text>
      </View>

      {templates && templates.length > 0 ? (
        <Question
          title="Preferred CV format"
          subtitle="Leave on Recommended to match the region your device is set to."
        >
          <Chip
            label="Recommended"
            selected={preferences.preferredFormat === ""}
            onPress={() => set({ preferredFormat: "" })}
          />
          {templates.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              hint={t.badge || undefined}
              selected={preferences.preferredFormat === t.id}
              onPress={() => set({ preferredFormat: t.id })}
            />
          ))}
        </Question>
      ) : null}

      <Question
        title="Experience level"
        subtitle="Shapes which sections lead and how the summary is pitched."
      >
        {EXPERIENCE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value || "unset"}
            label={opt.label}
            selected={preferences.experienceLevel === opt.value}
            onPress={() => set({ experienceLevel: opt.value })}
          />
        ))}
      </Question>

      <View style={styles.question}>
        <Text style={[styles.questionTitle, { color: c.text }]}>
          Role you're targeting
        </Text>
        <Text style={[styles.questionSubtitle, { color: c.muted }]}>
          Optional. Used to weight keywords towards those jobs — it never adds
          skills you don't have.
        </Text>
        <TextInput
          value={preferences.targetRole}
          onChangeText={(text) => set({ targetRole: text })}
          placeholder="e.g. Java Backend Developer, fintech"
          placeholderTextColor={c.placeholder}
          style={[
            styles.input,
            { color: c.text, borderColor: c.chipBorder, backgroundColor: c.chipBg },
          ]}
          returnKeyType="done"
        />
      </View>
    </View>
  );

  if (!scroll) return body;
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scrollContent}
    >
      {body}
    </ScrollView>
  );
}

const darkColors = {
  text: "#E2E8F0",
  muted: "#A0AEC0",
  accent: "#A5B4FC",
  chipBg: "rgba(255,255,255,0.06)",
  chipBgActive: "rgba(99,102,241,0.18)",
  chipBorder: "rgba(255,255,255,0.16)",
  placeholder: "#718096",
};

const lightColors = {
  text: "#1A202C",
  muted: "#718096",
  accent: "#4F46E5",
  chipBg: "rgba(0,0,0,0.03)",
  chipBgActive: "rgba(79,70,229,0.10)",
  chipBorder: "rgba(0,0,0,0.12)",
  placeholder: "#A0AEC0",
};

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 24 },
  question: { marginBottom: 24 },
  questionTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  questionSubtitle: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: "600" },
  note: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: -12,
    marginBottom: 24,
  },
  noteText: { fontSize: 12, lineHeight: 17 },
  chipHint: { fontSize: 11, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
});
