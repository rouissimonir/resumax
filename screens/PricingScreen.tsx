import React, { useState, useRef, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  useRevenueCat,
  isLifetimePackage,
} from "@/contexts/RevenueCatContext";
import {
  Spacing,
  BorderRadius,
  Typography,
  Gradients,
  Shadows,
  Animations,
} from "@/constants/theme";

const FEATURES = [
  { icon: "zap", text: "AI-powered resume enhancement" },
  { icon: "file-text", text: "Every CV format, including Europass" },
  { icon: "download", text: "Unlimited downloads" },
  { icon: "shield", text: "ATS-optimized output" },
];

/** Alias so the JSX below stays terse; source of truth lives in the context. */
const isLifetime = isLifetimePackage;

export default function PricingScreen() {
  const { theme, colorScheme } = useTheme();
  const {
    packages,
    purchasePackage,
    isPro,
    isLoading,
    restorePurchases,
    ownsLifetime,
    passExpiresAt,
  } = useRevenueCat();
  const insets = useSafeAreaInsets();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: Animations.slow,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: Animations.slow,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Default the selection to the lifetime tier when one exists — it's the
  // better deal for anyone who'll job hunt more than a couple of times, and
  // pre-selecting it makes the pass read as the budget option rather than
  // the default.
  useEffect(() => {
    if (selectedId || packages.length === 0) return;
    const lifetime = packages.find(isLifetime);
    setSelectedId((lifetime ?? packages[0]).identifier);
  }, [packages, selectedId]);

  const selected =
    packages.find((p) => p.identifier === selectedId) ?? packages[0] ?? null;

  const handlePurchase = async () => {
    if (!selected) return;
    setIsPurchasing(true);
    try {
      await purchasePackage(selected);
    } catch (error) {
      console.error(error);
    } finally {
      setIsPurchasing(false);
    }
  };

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // Already paid — show status instead of a purchase form.
  const proSubtitle = ownsLifetime
    ? "You have lifetime access. Thanks for the support."
    : passExpiresAt
      ? `Your pass is active until ${passExpiresAt.toLocaleDateString()}.`
      : "Enjoy unlimited access to all features.";

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScreenScrollView>
        <View style={styles.content}>
          <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
            <ThemedText
              style={[Typography.h1, styles.title, { textAlign: "center" }]}
            >
              {isPro ? "You're all set" : "Unlock unlimited CVs"}
            </ThemedText>
            <ThemedText
              style={[
                Typography.body,
                { color: theme.textSecondary, textAlign: "center" },
              ]}
            >
              {isPro
                ? proSubtitle
                : "No subscription. Pay once for a week, or once for good."}
            </ThemedText>
          </Animated.View>

          <Animated.View style={[styles.featuresSection, { opacity: fadeAnim }]}>
            <ThemedText style={[Typography.h3, { marginBottom: Spacing.lg }]}>
              What you get
            </ThemedText>
            {FEATURES.map((feature, index) => (
              <View key={index} style={styles.featureRow}>
                <View
                  style={[
                    styles.featureIcon,
                    { backgroundColor: theme.primaryLight + "30" },
                  ]}
                >
                  <Feather
                    name={feature.icon as any}
                    size={16}
                    color={theme.primary}
                  />
                </View>
                <ThemedText style={[Typography.body, { flex: 1 }]}>
                  {feature.text}
                </ThemedText>
              </View>
            ))}
          </Animated.View>

          {/* Tier options */}
          {!isPro && packages.length > 0 && (
            <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
              {packages.map((pack) => {
                const active = selected?.identifier === pack.identifier;
                const lifetime = isLifetime(pack);
                return (
                  <Pressable
                    key={pack.identifier}
                    onPress={() => setSelectedId(pack.identifier)}
                    style={[
                      styles.tierCard,
                      {
                        backgroundColor: theme.backgroundDefault,
                        borderColor: active ? theme.primary : theme.border,
                        borderWidth: active ? 2 : 1,
                      },
                      active && Shadows.glow,
                    ]}
                  >
                    <View style={styles.tierHead}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={Typography.h3}>
                          {pack.product.title}
                        </ThemedText>
                        <ThemedText
                          type="caption"
                          style={{ color: theme.textSecondary, marginTop: 2 }}
                        >
                          {lifetime
                            ? "One payment, yours forever"
                            : `Full access for 7 days`}
                        </ThemedText>
                      </View>
                      {lifetime && (
                        <View
                          style={[
                            styles.badge,
                            { backgroundColor: theme.primary },
                          ]}
                        >
                          <ThemedText
                            style={[Typography.caption, { color: "#FFF" }]}
                          >
                            BEST VALUE
                          </ThemedText>
                        </View>
                      )}
                    </View>

                    <View style={styles.tierPriceRow}>
                      <ThemedText
                        style={[Typography.h1, { color: theme.primary }]}
                      >
                        {pack.product.priceString}
                      </ThemedText>
                      <View
                        style={[
                          styles.radio,
                          {
                            borderColor: active ? theme.primary : theme.border,
                            backgroundColor: active
                              ? theme.primary
                              : "transparent",
                          },
                        ]}
                      >
                        {active && (
                          <Feather name="check" size={12} color="#FFF" />
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              })}

              <ThemedText
                type="caption"
                style={{
                  color: theme.textSecondary,
                  textAlign: "center",
                  marginTop: Spacing.sm,
                }}
              >
                Neither option renews automatically. You will not be charged again.
              </ThemedText>
            </Animated.View>
          )}

          {!isPro && packages.length === 0 && (
            <View style={styles.errorContainer}>
              <ThemedText style={{ color: theme.textSecondary }}>
                No plans available right now. Please try again later.
              </ThemedText>
            </View>
          )}
        </View>
      </ScreenScrollView>

      {!isPro && selected && (
        <View
          style={[
            styles.purchaseContainer,
            {
              backgroundColor: theme.backgroundDefault,
              paddingBottom: insets.bottom + Spacing.lg,
              borderTopColor: theme.border,
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.purchaseButton,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
            onPress={handlePurchase}
            disabled={isPurchasing}
          >
            <LinearGradient
              colors={
                colorScheme === "dark"
                  ? Gradients.dark.primary
                  : Gradients.light.primary
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.purchaseGradient}
            >
              <ThemedText style={[Typography.button, { color: "#FFF" }]}>
                {isPurchasing
                  ? "Processing..."
                  : `Continue — ${selected.product.priceString}`}
              </ThemedText>
            </LinearGradient>
          </Pressable>
          <Pressable
            onPress={restorePurchases}
            style={{ marginTop: Spacing.md, alignItems: "center" }}
          >
            <ThemedText
              style={[Typography.caption, { color: theme.textSecondary }]}
            >
              Restore Purchases
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 140,
  },
  header: {
    alignItems: "center",
    marginVertical: Spacing["2xl"],
  },
  title: {
    marginBottom: Spacing.sm,
  },
  tierCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  tierHead: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  tierPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  featuresSection: {
    marginBottom: Spacing["2xl"],
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  purchaseContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
  },
  purchaseButton: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    ...Shadows.glow,
  },
  purchaseGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
});
