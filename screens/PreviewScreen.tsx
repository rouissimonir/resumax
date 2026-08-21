import React, { useState, useRef, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  Animated,
  ActivityIndicator,
  ScrollView,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RatingModal } from "@/components/RatingModal";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { CVSuggestionsCard } from "@/components/CVSuggestionsCard";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Typography,
  Animations,
  Hairline,
  PressedOpacity,
} from "@/constants/theme";
import { useResumes } from "@/contexts/ResumeContext";
import { useRevenueCat } from "@/contexts/RevenueCatContext";
import { resumeApi } from "@/services/resumeApi";
import { HomeStackParamList } from "@/navigation/HomeStackNavigator";

type PreviewRouteProp = RouteProp<HomeStackParamList, "Preview">;
type NavigationProp = NativeStackNavigationProp<HomeStackParamList, "Preview">;

export default function PreviewScreen() {
  const { theme } = useTheme();
  const route = useRoute<PreviewRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { getResumeById, updateResume } = useResumes();
  const {
    isPro,
    userId,
    canDownload,
    freeDownloadUsed,
    consumeFreeDownload,
  } = useRevenueCat();
  const insets = useSafeAreaInsets();

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);

  // A single, short entrance. Nothing loops.
  const enterAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const resume = getResumeById(route.params.resumeId);

  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: Animations.slow,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: downloadProgress,
      duration: Animations.normal,
      useNativeDriver: false,
    }).start();
  }, [downloadProgress]);

  const handleShare = async () => {
    if (!resume) return;
    try {
      const downloadUrl = resumeApi.getDownloadUrl(resume.id);

      if (Platform.OS === "web") {
        if (navigator.share) {
          await navigator.share({
            title: "My Improved Resume",
            text: "Check out my professionally formatted resume",
            url: downloadUrl,
          });
        } else {
          await navigator.clipboard.writeText(downloadUrl);
          Alert.alert("Link copied", "Download link copied to clipboard.");
        }
        return;
      }

      const fileUri = FileSystem.documentDirectory + "CV.pdf";
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        fileUri,
      );
      const result = await downloadResumable.downloadAsync();

      if (!result || result.status !== 200) {
        throw new Error("Failed to download PDF for sharing");
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/pdf",
          dialogTitle: "Share your CV",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert(
          "Sharing unavailable",
          "Sharing is not available on this device.",
        );
      }
    } catch (error: any) {
      console.error("Share error:", error);
      Alert.alert("Share failed", error.message || "Failed to share resume.");
    }
  };

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleShare}
          hitSlop={10}
          accessibilityLabel="Share resume"
          style={({ pressed }) => [
            styles.headerButton,
            pressed && { opacity: PressedOpacity },
          ]}
        >
          <Feather name="share" size={19} color={theme.text} />
          <ThemedText style={styles.headerButtonLabel}>Share</ThemedText>
        </Pressable>
      ),
    });
  }, [navigation, theme]);

  if (!resume) {
    return (
      <ScreenScrollView>
        <View style={styles.emptyState}>
          <ThemedText type="h3">Resume not found</ThemedText>
          <ThemedText tone="secondary" style={{ marginTop: Spacing.xs }}>
            It may have been cleared from this session.
          </ThemedText>
        </View>
      </ScreenScrollView>
    );
  }

  /**
   * Spend the one-off free download, but only if that's what actually paid
   * for this file. Pro users must never burn it — otherwise a subscriber
   * who later lapses would find their free credit already gone.
   *
   * Called only after the PDF has genuinely landed, so a failed generate or
   * download leaves the credit intact and the user can retry.
   */
  const settleFreeDownload = async () => {
    if (!isPro && !freeDownloadUsed) {
      await consumeFreeDownload();
    }
    // Marks THIS resume as covered, so ResumeDetailScreen can let a later
    // re-download through without re-charging the free credit or blocking a
    // lapsed-Pro user from a file they already paid for.
    updateResume(resume.id, { paidFor: true });
  };

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      setDownloadSuccess(false);
      setDownloadProgress(0);

      // Every install gets one free download. Gate on canDownload rather
      // than isPro so that first one gets through without a purchase.
      if (!canDownload) {
        Alert.alert(
          "You've used your free CV",
          "Tailoring your CV to each job is what actually moves the needle — " +
            "unlock unlimited downloads to keep going.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "See plans",
              onPress: () => navigation.navigate("Pricing" as any),
            },
          ],
        );
        setIsDownloading(false);
        return;
      }

      if (!userId) {
        Alert.alert("Error", "User ID not found. Please restart the app.");
        setIsDownloading(false);
        return;
      }

      // /api/generate-pdf is Pro-gated server-side — regenerating with a
      // chosen template is the paid "every CV format" feature (see
      // PricingScreen). A free user's one download is of the file
      // /api/upload-resume already rendered with their original template
      // choice, so calling generate-pdf unconditionally here made every free
      // download 403 with "Pro access required to generate PDF" before it
      // ever reached the paywall gate above. Only Pro users need — or are
      // allowed — to trigger a regenerate.
      if (isPro) {
        // Pass the template the user actually chose. Omitting it made the
        // server fall back to "professional", so any other choice was
        // silently discarded at download time.
        await resumeApi.generatePdf(resume.id, userId, resume.templateId);
      }
      const downloadUrl = resumeApi.getDownloadUrl(resume.id);

      if (Platform.OS === "web") {
        for (let i = 0; i <= 100; i += 20) {
          setDownloadProgress(i);
          await new Promise((r) => setTimeout(r, 100));
        }
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error("Failed to download PDF");
        window.open(downloadUrl, "_blank");

        await settleFreeDownload();
        setDownloadSuccess(true);
        setTimeout(() => setDownloadSuccess(false), 3000);
        return;
      }

      const fileUri = FileSystem.documentDirectory + "CV.pdf";
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        fileUri,
        {},
        (progress) => {
          setDownloadProgress(
            Math.round(
              (progress.totalBytesWritten /
                progress.totalBytesExpectedToWrite) *
                100,
            ),
          );
        },
      );

      const result = await downloadResumable.downloadAsync();
      if (!result || result.status !== 200) throw new Error("Download failed");

      await settleFreeDownload();

      setDownloadSuccess(true);

      if (Platform.OS !== "web") {
        setTimeout(() => setShowRatingPrompt(true), 2000);
      }

      setTimeout(async () => {
        if (Platform.OS === "android") {
          try {
            const permissions =
              await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
            if (permissions.granted) {
              const base64 = await FileSystem.readAsStringAsync(result.uri, {
                encoding: FileSystem.EncodingType.Base64,
              });
              const newFileUri =
                await FileSystem.StorageAccessFramework.createFileAsync(
                  permissions.directoryUri,
                  "Resume.pdf",
                  "application/pdf",
                );
              await FileSystem.writeAsStringAsync(newFileUri, base64, {
                encoding: FileSystem.EncodingType.Base64,
              });
              Alert.alert("Saved", "PDF saved to the selected folder.");
            }
          } catch {
            // fall through to the share sheet below
          }
        }

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, {
            mimeType: "application/pdf",
            UTI: "com.adobe.pdf",
            dialogTitle: "Open with…",
          });
        }
        setDownloadSuccess(false);
      }, 1000);
    } catch (error: any) {
      Alert.alert(
        "Download failed",
        error.message || "Could not download the PDF. Please try again.",
      );
      console.error(error);
      setDownloadSuccess(false);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const specs = [
    { label: "Format", value: "Harvard" },
    { label: "Optimised for", value: "Applicant tracking" },
    { label: "Source file", value: resume.originalFilename },
  ];

  const actions = [
    { icon: "file-text", label: "Preview content", onPress: () => setShowPreview(true) },
    { icon: "share", label: "Share resume", onPress: handleShare },
  ];

  return (
    <>
      <ScreenScrollView>
        <Animated.View
          style={[
            styles.container,
            {
              opacity: enterAnim,
              transform: [
                {
                  translateY: enterAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Status — left aligned, compact. No hero medallion. */}
          <View style={styles.status}>
            <View
              style={[
                styles.statusMark,
                { backgroundColor: theme.success + "1A" },
              ]}
            >
              <Feather name="check" size={15} color={theme.success} />
            </View>
            <View style={styles.statusText}>
              <ThemedText type="h1">Resume improved</ThemedText>
              <ThemedText tone="secondary" style={{ marginTop: 2 }}>
                Rewritten, reformatted and ready to download.
              </ThemedText>
            </View>
          </View>

          {/* Spec table — replaces three identical stat tiles. */}
          <View style={[styles.group, { borderColor: theme.border }]}>
            {specs.map((spec, i) => (
              <View
                key={spec.label}
                style={[
                  styles.specRow,
                  i > 0 && {
                    borderTopWidth: Hairline,
                    borderTopColor: theme.border,
                  },
                ]}
              >
                <ThemedText tone="secondary" type="bodySmall">
                  {spec.label}
                </ThemedText>
                <ThemedText
                  type="bodySmall"
                  style={styles.specValue}
                  numberOfLines={1}
                >
                  {spec.value}
                </ThemedText>
              </View>
            ))}
          </View>

          <CVSuggestionsCard data={resume.improvedText} />

          {/* Actions — one grouped list, hairline separated. */}
          <View
            style={[
              styles.group,
              { borderColor: theme.border, marginTop: Spacing.xl },
            ]}
          >
            {actions.map((action, i) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                style={({ pressed }) => [
                  styles.actionRow,
                  i > 0 && {
                    borderTopWidth: Hairline,
                    borderTopColor: theme.border,
                  },
                  pressed && { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Feather
                  name={action.icon as any}
                  size={17}
                  color={theme.textSecondary}
                />
                <ThemedText style={styles.actionLabel}>
                  {action.label}
                </ThemedText>
                <Feather
                  name="chevron-right"
                  size={17}
                  color={theme.textMuted}
                />
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </ScreenScrollView>

      {/* Download bar */}
      <View
        style={[
          styles.bar,
          {
            backgroundColor: theme.backgroundRoot,
            borderTopColor: theme.border,
            paddingBottom: insets.bottom + Spacing.md,
          },
        ]}
      >
        {isDownloading && (
          <Animated.View
            style={[
              styles.barProgress,
              { backgroundColor: theme.text, width: progressWidth },
            ]}
          />
        )}

        <Pressable
          onPress={handleDownload}
          disabled={isDownloading}
          style={({ pressed }) => [
            styles.downloadButton,
            {
              backgroundColor: downloadSuccess ? theme.success : theme.primary,
            },
            pressed && !isDownloading && { opacity: 0.88 },
            isDownloading && { opacity: 0.7 },
          ]}
        >
          {isDownloading ? (
            <>
              <ActivityIndicator size="small" color={theme.buttonText} />
              <ThemedText
                style={[
                  Typography.button,
                  { color: theme.buttonText, marginLeft: Spacing.sm },
                ]}
              >
                Downloading {downloadProgress}%
              </ThemedText>
            </>
          ) : (
            <>
              <Feather
                name={downloadSuccess ? "check" : "download"}
                size={17}
                color={theme.buttonText}
              />
              <ThemedText
                style={[
                  Typography.button,
                  { color: theme.buttonText, marginLeft: Spacing.sm },
                ]}
              >
                {downloadSuccess ? "Downloaded" : "Download PDF"}
              </ThemedText>
            </>
          )}
        </Pressable>

        {/* Tell the user which "bucket" this download comes out of before
            they tap, rather than surprising them with a paywall after. */}
        <ThemedText tone="muted" type="small" style={styles.barNote}>
          {isPro
            ? "PDF · no watermark"
            : freeDownloadUsed
              ? "PDF · unlock to download"
              : "PDF · your free CV, no watermark"}
        </ThemedText>
      </View>

      <RatingModal
        visible={showRatingPrompt}
        onClose={() => setShowRatingPrompt(false)}
      />

      {/* Document preview */}
      <Modal
        visible={showPreview}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPreview(false)}
      >
        <View
          style={[
            styles.modal,
            { backgroundColor: theme.backgroundRoot },
          ]}
        >
          <View
            style={[styles.modalHeader, { borderBottomColor: theme.border }]}
          >
            <ThemedText type="h3">Content</ThemedText>
            <Pressable
              onPress={() => setShowPreview(false)}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: PressedOpacity }}
            >
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <DocumentPreview raw={resume.improvedText} theme={theme} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/** Renders the parsed resume as a document, not as app chrome. */
function DocumentPreview({ raw, theme }: { raw: unknown; theme: any }) {
  let data: any;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <View style={styles.emptyState}>
        <ThemedText tone="secondary">
          Could not read the resume content. The PDF will still download
          correctly.
        </ThemedText>
      </View>
    );
  }

  const header = data.header ?? {};
  const experience = Array.isArray(data.experience) ? data.experience : [];
  const education = Array.isArray(data.education) ? data.education : [];
  const contact = [
    header.address || header.location,
    header.phone,
    header.email,
    header.linkedin,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const Section = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <View style={styles.docSection}>
      <ThemedText type="overline" tone="secondary">
        {title}
      </ThemedText>
      <View
        style={[styles.docRule, { backgroundColor: theme.text }]}
      />
      {children}
    </View>
  );

  return (
    <View
      style={[
        styles.doc,
        {
          backgroundColor: theme.backgroundDefault,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={styles.docHeader}>
        <ThemedText type="h2" style={styles.docName}>
          {header.name || "Your name"}
        </ThemedText>
        {!!contact && (
          <ThemedText
            tone="secondary"
            type="bodySmall"
            style={styles.docContact}
          >
            {contact}
          </ThemedText>
        )}
      </View>

      {experience.length > 0 && (
        <Section title="EXPERIENCE">
          {experience.map((exp: any, idx: number) => (
            <View key={idx} style={styles.docEntry}>
              <View style={styles.docEntryHead}>
                <ThemedText type="h4" style={styles.docEntryTitle}>
                  {exp.role}
                </ThemedText>
                <ThemedText tone="muted" type="small">
                  {exp.date}
                </ThemedText>
              </View>
              <ThemedText tone="secondary" type="bodySmall">
                {[exp.company, exp.location].filter(Boolean).join(" · ")}
              </ThemedText>
              {(Array.isArray(exp.bullets) ? exp.bullets : []).map(
                (bullet: string, bidx: number) => (
                  <View key={bidx} style={styles.docBullet}>
                    <ThemedText tone="muted" style={styles.docBulletDot}>
                      ·
                    </ThemedText>
                    <ThemedText type="bodySmall" style={{ flex: 1 }}>
                      {bullet}
                    </ThemedText>
                  </View>
                ),
              )}
            </View>
          ))}
        </Section>
      )}

      {education.length > 0 && (
        <Section title="EDUCATION">
          {education.map((edu: any, idx: number) => (
            <View key={idx} style={styles.docEntry}>
              <View style={styles.docEntryHead}>
                <ThemedText type="h4" style={styles.docEntryTitle}>
                  {edu.degree}
                </ThemedText>
                <ThemedText tone="muted" type="small">
                  {edu.date}
                </ThemedText>
              </View>
              <ThemedText tone="secondary" type="bodySmall">
                {[edu.school, edu.location].filter(Boolean).join(" · ")}
              </ThemedText>
            </View>
          ))}
        </Section>
      )}

      {!!data.skills && (
        <Section title="SKILLS">
          <ThemedText type="bodySmall">
            {Array.isArray(data.skills) ? data.skills.join(", ") : data.skills}
          </ThemedText>
        </Section>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 150,
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
  },
  headerButtonLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  emptyState: {
    padding: Spacing.xl,
  },

  // Status
  status: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.xl,
  },
  statusMark: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
  },
  statusText: {
    flex: 1,
    marginLeft: Spacing.md,
  },

  // Grouped lists
  group: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  specRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  specValue: {
    fontWeight: "500",
    flexShrink: 1,
    marginLeft: Spacing.lg,
    textAlign: "right",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  actionLabel: {
    flex: 1,
    marginLeft: Spacing.md,
  },

  // Bottom bar
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  barProgress: {
    position: "absolute",
    top: 0,
    left: 0,
    height: 2,
  },
  downloadButton: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  barNote: {
    textAlign: "center",
    marginTop: Spacing.sm,
  },

  // Modal
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
  },
  modalBody: {
    padding: Spacing.lg,
  },

  // Document
  doc: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.xl,
  },
  docHeader: {
    alignItems: "center",
    paddingBottom: Spacing.lg,
  },
  docName: {
    textAlign: "center",
  },
  docContact: {
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  docSection: {
    marginTop: Spacing.lg,
  },
  docRule: {
    height: 1,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
    opacity: 0.85,
  },
  docEntry: {
    marginBottom: Spacing.lg,
  },
  docEntryHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  docEntryTitle: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  docBullet: {
    flexDirection: "row",
    marginTop: Spacing.xs,
  },
  docBulletDot: {
    width: 12,
  },
});
