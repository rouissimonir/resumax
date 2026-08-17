import React, { ReactNode } from "react";
import {
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  Animations,
} from "@/constants/theme";

interface ButtonProps {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "small" | "medium" | "large";
  /** Optional leading element, e.g. an icon. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  onPress,
  children,
  style,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "medium",
  icon,
  fullWidth = false,
}: ButtonProps) {
  const { theme } = useTheme();
  const pressed = useSharedValue(0);

  // Opacity rather than scale: a button that shrinks on every tap is the
  // tell-tale sign of a templated interface.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(pressed.value ? 0.86 : 1, {
      duration: Animations.instant,
    }),
  }));

  const sizeStyle = (() => {
    switch (size) {
      case "small":
        return { height: 36, paddingHorizontal: Spacing.md };
      case "large":
        return { height: 52, paddingHorizontal: Spacing.xl };
      default:
        return { height: Spacing.buttonHeight, paddingHorizontal: Spacing.lg };
    }
  })();

  const surface: ViewStyle = (() => {
    switch (variant) {
      case "primary":
        return { backgroundColor: theme.primary };
      case "destructive":
        return { backgroundColor: theme.error };
      case "secondary":
        return {
          backgroundColor: theme.backgroundSecondary,
          borderWidth: 1,
          borderColor: theme.border,
        };
      case "outline":
        return {
          backgroundColor: "transparent",
          borderWidth: 1,
          borderColor: theme.border,
        };
      default:
        return { backgroundColor: "transparent" };
    }
  })();

  const contentColor =
    variant === "primary" || variant === "destructive"
      ? theme.buttonText
      : theme.text;

  return (
    <AnimatedPressable
      onPress={disabled || loading ? undefined : onPress}
      onPressIn={() => {
        pressed.value = 1;
      }}
      onPressOut={() => {
        pressed.value = 0;
      }}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.button,
        sizeStyle,
        surface,
        fullWidth && styles.fullWidth,
        disabled && { opacity: 0.4 },
        style,
        animatedStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <ThemedText style={[Typography.button, { color: contentColor }]}>
            {children}
          </ThemedText>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    marginRight: Spacing.sm,
  },
});
