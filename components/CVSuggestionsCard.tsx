import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Typography,
  Animations,
  Hairline,
  PressedOpacity,
} from "@/constants/theme";
import {
  analyseCV,
  scoreLabel,
  type CVSuggestion,
  type SuggestionSeverity,
} from "@/services/cvSuggestions";

const VISIBLE_BY_DEFAULT = 3;

type Props = {
  /** The structured resume payload (JSON string or object). */
  data: unknown;
};

export function CVSuggestionsCard({ data }: Props) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const analysis = useMemo(() => analyseCV(data), [data]);

  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(180),
      Animated.timing(progressAnim, {
        toValue: analysis.score,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [analysis.score]);

  // Nothing parseable — render nothing rather than an empty shell.
  if (analysis.score === 0 && analysis.suggestions.length === 0) {
    return null;
  }

  const severityColor = (severity: SuggestionSeverity) =>
    severity === "critical"
      ? theme.error
      : severity === "important"
        ? theme.warning
        : theme.textMuted;

  const severityLabel = (severity: SuggestionSeverity) =>
    severity === "critical"
      ? "ESSENTIAL"
      : severity === "important"
        ? "RECOMMENDED"
        : "OPTIONAL";

  const scoreColor =
    analysis.score >= 80
      ? theme.success
      : analysis.score >= 55
        ? theme.warning
        : theme.error;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const criticalCount = analysis.suggestions.filter(
    (s) => s.severity === "critical",
  ).length;

  const visible = expanded
    ? analysis.suggestions
    : analysis.suggestions.slice(0, VISIBLE_BY_DEFAULT);
  const hiddenCount = analysis.suggestions.length - visible.length;

  const summary = analysis.isComplete
    ? "Nothing missing — your CV covers what recruiters look for."
    : criticalCount > 0
      ? `${criticalCount} essential ${criticalCount === 1 ? "detail is" : "details are"} missing.`
      : `${analysis.suggestions.length} ${analysis.suggestions.length === 1 ? "change" : "changes"} would make this more relevant.`;

  return (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.backgroundDefault },
      ]}
    >
      {/* Header */}
      <View style={styles.head}>
        <View style={styles.headText}>
          <ThemedText type="overline" tone="muted">
            RESUME STRENGTH
          </ThemedText>
          <ThemedText type="h3" style={{ marginTop: 4 }}>
            {scoreLabel(analysis.score)}
          </ThemedText>
        </View>
        <ThemedText type="numeric" style={{ color: scoreColor }}>
          {analysis.score}
          <ThemedText style={styles.scoreUnit}>%</ThemedText>
        </ThemedText>
      </View>

      {/* Meter */}
      <View
        style={[styles.track, { backgroundColor: theme.backgroundTertiary }]}
      >
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: scoreColor, width: progressWidth },
          ]}
        />
      </View>

      <ThemedText tone="secondary" type="bodySmall" style={styles.summary}>
        {summary}
      </ThemedText>

      {/* Suggestions */}
      {!analysis.isComplete && (
        <View style={styles.list}>
          {visible.map((item) => (
            <Row
              key={item.id}
              item={item}
              color={severityColor(item.severity)}
              label={severityLabel(item.severity)}
              theme={theme}
            />
          ))}

          {(hiddenCount > 0 || expanded) && (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.toggle,
                { borderTopColor: theme.border },
                pressed && { opacity: PressedOpacity },
              ]}
            >
              <ThemedText type="caption" style={{ color: theme.text }}>
                {expanded ? "Show less" : `Show ${hiddenCount} more`}
              </ThemedText>
              <Feather
                name={expanded ? "chevron-up" : "chevron-down"}
                size={15}
                color={theme.text}
                style={{ marginLeft: 4 }}
              />
            </Pressable>
          )}
        </View>
      )}

      {/* What's already covered */}
      {analysis.strengths.length > 0 && (
        <View style={[styles.strengths, { borderTopColor: theme.border }]}>
          <Feather name="check" size={12} color={theme.success} />
          <ThemedText tone="muted" type="small" style={styles.strengthsText}>
            {analysis.strengths.join(" · ")}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function Row({
  item,
  color,
  label,
  theme,
}: {
  item: CVSuggestion;
  color: string;
  label: string;
  theme: any;
}) {
  return (
    <View style={[styles.row, { borderTopColor: theme.border }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <ThemedText type="h4" style={styles.rowTitle}>
            {item.title}
          </ThemedText>
          <ThemedText style={[styles.rowTag, { color }]}>{label}</ThemedText>
        </View>
        <ThemedText tone="secondary" type="bodySmall" style={{ marginTop: 3 }}>
          {item.detail}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginTop: Spacing.xl,
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  headText: {
    flex: 1,
  },
  scoreUnit: {
    ...Typography.h4,
  },
  track: {
    height: 3,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: BorderRadius.full,
  },
  summary: {
    marginTop: Spacing.md,
  },
  list: {
    marginTop: Spacing.md,
  },
  row: {
    flexDirection: "row",
    paddingTop: Spacing.lg,
    marginTop: Spacing.md,
    borderTopWidth: Hairline,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  rowBody: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  rowTitle: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  rowTag: {
    ...Typography.overline,
    fontSize: 9,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: Hairline,
  },
  strengths: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: Hairline,
  },
  strengthsText: {
    flex: 1,
    marginLeft: 6,
  },
});
