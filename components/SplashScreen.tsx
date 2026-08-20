/**
 * Animated splash screen shown on app launch.
 *
 * Purely presentational — visibility is controlled entirely by the parent
 * (App.tsx), which mounts this for a guaranteed minimum duration and
 * unmounts it once real app data is ready. It used to run its own internal
 * timer too, which raced with the parent's and could unmount this component
 * (rendering nothing) while the parent still believed the splash was up,
 * producing a blank flash. Keep this component free of timing logic.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

export function SplashScreen() {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.logoContainer}>
        <AnimatedLogo variant="draw" size={200} speed="normal" />
      </View>

      <View style={styles.textContainer}>
        <ThemedText type="h1" style={[styles.brandName, { color: theme.primary }]}>
          Resumax
        </ThemedText>
        <ThemedText tone="secondary" type="bodySmall" style={styles.tagline}>
          AI-powered resume optimization
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  logoContainer: {
    marginBottom: Spacing.xl,
  },
  textContainer: {
    alignItems: "center",
    marginTop: Spacing.xl,
  },
  brandName: {
    letterSpacing: 1,
  },
  tagline: {
    marginTop: Spacing.sm,
  },
});
