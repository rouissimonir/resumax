import React from "react";
import { StyleSheet, ViewStyle, Pressable } from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Shadows,
  PressedOpacity,
} from "@/constants/theme";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /**
   * `default`  — bordered surface, the workhorse.
   * `elevated` — very slight lift, for things that float above content.
   * `outlined` — same as default; kept for source compatibility.
   * `flat`     — no border, just a tinted background block.
   */
  variant?: "default" | "elevated" | "outlined" | "flat";
  /** Remove the built-in padding when the content manages its own. */
  bare?: boolean;
}

export function Card({
  children,
  style,
  onPress,
  variant = "default",
  bare = false,
}: CardProps) {
  const { theme } = useTheme();

  const variantStyle: ViewStyle = (() => {
    switch (variant) {
      case "elevated":
        return {
          backgroundColor: theme.backgroundDefault,
          borderWidth: 1,
          borderColor: theme.border,
          ...Shadows.medium,
        };
      case "flat":
        return { backgroundColor: theme.backgroundSecondary };
      default:
        return {
          backgroundColor: theme.backgroundDefault,
          borderWidth: 1,
          borderColor: theme.border,
        };
    }
  })();

  const cardStyle = [
    styles.card,
    !bare && styles.padded,
    variantStyle,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          cardStyle,
          pressed && { opacity: PressedOpacity },
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <ThemedView style={cardStyle}>{children}</ThemedView>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  padded: {
    padding: Spacing.lg,
  },
});
