import React, { useEffect, useState } from "react";
import {
  View,
  Modal,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import {
  useRevenueCat,
  isLifetimePackage,
} from "@/contexts/RevenueCatContext";

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
}

const isLifetime = isLifetimePackage;

export function PaywallModal({ visible, onClose }: PaywallModalProps) {
  const { theme } = useTheme();
  const { packages, purchasePackage, isLoading, restorePurchases } =
    useRevenueCat();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);

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
      onClose();
    } finally {
      setIsPurchasing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View
        style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: theme.primary + "15" },
            ]}
          >
            <Feather name="star" size={44} color={theme.primary} />
          </View>

          <ThemedText
            style={[
              Typography.h1,
              { textAlign: "center", marginTop: Spacing.lg },
            ]}
          >
            Keep going
          </ThemedText>

          <ThemedText
            style={[
              Typography.body,
              {
                textAlign: "center",
                marginTop: Spacing.sm,
                color: theme.textSecondary,
              },
            ]}
          >
            You've used your free CV. Tailoring a version per application is
            what actually gets interviews — unlock unlimited CVs and downloads.
          </ThemedText>

          <View style={styles.features}>
            {[
              "Unlimited AI improvements",
              "Every format, including Europass",
              "ATS optimization",
              "No watermarks",
            ].map((feature, index) => (
              <View key={index} style={styles.featureRow}>
                <Feather name="check" size={18} color={theme.success} />
                <ThemedText
                  style={[Typography.body, { marginLeft: Spacing.md }]}
                >
                  {feature}
                </ThemedText>
              </View>
            ))}
          </View>

          {isLoading ? (
            <ActivityIndicator
              size="large"
              color={theme.primary}
              style={{ marginTop: Spacing.xl }}
            />
          ) : (
            <View style={styles.tiers}>
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
                        borderColor: active ? theme.primary : theme.border,
                        borderWidth: active ? 2 : 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText style={Typography.h4}>
                        {pack.product.title}
                      </ThemedText>
                      <ThemedText
                        type="caption"
                        style={{ color: theme.textSecondary, marginTop: 2 }}
                      >
                        {lifetime ? "Yours forever" : "Full access for 7 days"}
                      </ThemedText>
                    </View>
                    <ThemedText
                      style={[Typography.h3, { color: theme.primary }]}
                    >
                      {pack.product.priceString}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        {selected && (
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.purchaseButton,
                { backgroundColor: theme.primary },
                pressed && { opacity: 0.9 },
              ]}
              onPress={handlePurchase}
              disabled={isPurchasing}
            >
              <ThemedText
                style={[Typography.button, { color: theme.buttonText }]}
              >
                {isPurchasing
                  ? "Processing..."
                  : `Continue — ${selected.product.priceString}`}
              </ThemedText>
            </Pressable>

            <ThemedText
              type="caption"
              style={{
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: Spacing.sm,
              }}
            >
              One-time payment. Nothing renews automatically.
            </ThemedText>

            <Pressable onPress={restorePurchases} style={{ marginTop: Spacing.md }}>
              <ThemedText
                style={[
                  Typography.caption,
                  { color: theme.textSecondary, textAlign: "center" },
                ]}
              >
                Restore Purchases
              </ThemedText>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    alignItems: "flex-end",
  },
  closeButton: {
    padding: Spacing.sm,
  },
  content: {
    padding: Spacing.xl,
    alignItems: "center",
    paddingBottom: Spacing.xl,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  features: {
    marginTop: Spacing.xl,
    width: "100%",
    gap: Spacing.sm,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tiers: {
    width: "100%",
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  tierCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  purchaseButton: {
    width: "100%",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    ...Shadows.medium,
  },
});
