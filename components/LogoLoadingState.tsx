/**
 * Loading state overlay with animated logo.
 * Use when processing resumes, uploading files, etc.
 */

import React from "react";
import { View, StyleSheet, Modal } from "react-native";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface LogoLoadingProps {
  visible: boolean;
  message?: string;
  submessage?: string;
}

export function LogoLoading({
  visible,
  message = "Processing",
  submessage,
}: LogoLoadingProps) {
  const { theme } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={[
          styles.overlay,
          { backgroundColor: `${theme.backgroundRoot}99` },
        ]}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <AnimatedLogo variant="pulse" size={100} speed="normal" />

          {message && (
            <ThemedText type="h3" style={styles.message}>
              {message}
            </ThemedText>
          )}

          {submessage && (
            <ThemedText
              tone="secondary"
              type="bodySmall"
              style={styles.submessage}
            >
              {submessage}
            </ThemedText>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Inline loading spinner with animated logo.
 * Use in buttons, lists, or progress sections.
 */
export function LogoSpinner({ size = 48, message }: { size?: number; message?: string }) {
  return (
    <View style={styles.spinnerContainer}>
      <AnimatedLogo variant="pulse" size={size} speed="normal" />
      {message && (
        <ThemedText type="bodySmall" tone="secondary" style={styles.spinnerMessage}>
          {message}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * Empty state with animated logo bounce.
 */
export function LogoEmptyState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.emptyState}>
      <AnimatedLogo variant="bounce" size={120} speed="slow" />

      <ThemedText type="h2" style={styles.emptyTitle}>
        {title}
      </ThemedText>

      {subtitle && (
        <ThemedText tone="secondary" style={styles.emptySubtitle}>
          {subtitle}
        </ThemedText>
      )}

      {action && <View style={styles.emptyAction}>{action}</View>}
    </View>
  );
}

/**
 * Animated logo badge for navigation or status indicators.
 */
export function LogoBadge({ size = 32, variant = "pulse" }: { size?: number; variant?: "pulse" | "arrow-pulse" | "static" }) {
  return (
    <View style={[styles.badge, { width: size, height: size }]}>
      <AnimatedLogo variant={variant} size={size} speed="normal" />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.xl,
    alignItems: "center",
    maxWidth: 280,
  },
  message: {
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  submessage: {
    marginTop: Spacing.sm,
    textAlign: "center",
  },

  spinnerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  spinnerMessage: {
    marginTop: Spacing.sm,
  },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  emptyTitle: {
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  emptySubtitle: {
    marginTop: Spacing.sm,
    textAlign: "center",
    maxWidth: 280,
  },
  emptyAction: {
    marginTop: Spacing.xl,
  },

  badge: {
    justifyContent: "center",
    alignItems: "center",
  },
});
