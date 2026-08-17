import { Text, type TextProps } from "react-native";

import { useTheme } from "@/hooks/useTheme";
import { Typography } from "@/constants/theme";

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?:
    | "hero"
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "body"
    | "bodySmall"
    | "caption"
    | "small"
    | "button"
    | "link"
    | "overline"
    | "numeric";
  /** Common colour roles, so screens stop hand-rolling `{ color: … }`. */
  tone?: "default" | "secondary" | "muted";
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = "body",
  tone = "default",
  ...rest
}: ThemedTextProps) {
  const { theme, isDark } = useTheme();

  const getColor = () => {
    if (isDark && darkColor) return darkColor;
    if (!isDark && lightColor) return lightColor;
    if (tone === "secondary") return theme.textSecondary;
    if (tone === "muted") return theme.textMuted;
    if (type === "link") return theme.link;
    return theme.text;
  };

  const getTypeStyle = () => {
    switch (type) {
      case "hero":
        return Typography.hero;
      case "h1":
        return Typography.h1;
      case "h2":
        return Typography.h2;
      case "h3":
        return Typography.h3;
      case "h4":
        return Typography.h4;
      case "body":
        return Typography.body;
      case "bodySmall":
        return Typography.bodySmall;
      case "caption":
        return Typography.caption;
      case "small":
        return Typography.small;
      case "button":
        return Typography.button;
      case "link":
        return Typography.link;
      case "overline":
        return Typography.overline;
      case "numeric":
        return Typography.numeric;
      default:
        return Typography.body;
    }
  };

  return (
    <Text style={[{ color: getColor() }, getTypeStyle(), style]} {...rest} />
  );
}
