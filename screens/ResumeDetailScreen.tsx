import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  Modal,
  ScrollView,
  Animated,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography, Shadows, Hairline } from "@/constants/theme";
import { useResumes } from "@/contexts/ResumeContext";
import { useRevenueCat } from "@/contexts/RevenueCatContext";
import { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";
import { resumeApi } from "@/services/resumeApi";
import { RatingModal } from "@/components/RatingModal";

type ResumeDetailRouteProp = RouteProp<HistoryStackParamList, "ResumeDetail">;
type NavigationProp = NativeStackNavigationProp<
  HistoryStackParamList,
  "ResumeDetail"
>;

export default function ResumeDetailScreen() {
  const { theme } = useTheme();
  const route = useRoute<ResumeDetailRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { getResumeById, updateResume } = useResumes();
  const { isPro, freeDownloadUsed, canDownload, consumeFreeDownload } =
    useRevenueCat();
  const insets = useSafeAreaInsets();

  const [isDownloading, setIsDownloading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);

  const resume = getResumeById(route.params.resumeId);

  if (!resume) {
    return (
      <ScreenScrollView>
        <View style={styles.container}>
          <ThemedText>Resume not found</ThemedText>
        </View>
      </ScreenScrollView>
    );
  }

  /**
   * Marks this resume as covered (so a later re-download here or in
   * PreviewScreen never re-charges it) and, only if that's what actually
   * paid for it, spends the account's one-time free credit. Pro downloads
   * don't touch the credit at all.
   */
  const settleDownload = async () => {
    if (!isPro && !freeDownloadUsed) {
      await consumeFreeDownload();
    }
    updateResume(resume.id, { paidFor: true });
  };

  const handleDownload = async () => {
    // This screen used to hit /api/download/{id} with no gate at all. Since
    // /api/upload-resume already renders a PDF on the first pass, that made
    // PreviewScreen's canDownload check the ONLY thing standing between a
    // free user and unlimited downloads — skip it here, open History, and
    // every resume downloads free forever. A resume already paid for (its
    // own free credit already spent on it, or downloaded while Pro) is
    // exempt, so this doesn't charge twice for the same file.
    if (!resume.paidFor && !canDownload) {
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
      return;
    }

    try {
      setIsDownloading(true);
      const downloadUrl = resumeApi.getDownloadUrl(resume.id);

      if (Platform.OS === "web") {
        window.open(downloadUrl, "_blank");
        await settleDownload();
        return;
      }

      const fileUri = FileSystem.documentDirectory + "CV.pdf";
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        fileUri,
      );
      const result = await downloadResumable.downloadAsync();

      if (!result || result.status !== 200) throw new Error("Download failed");

      await settleDownload();

      // Prompt for rating after success
      setTimeout(() => setShowRatingPrompt(true), 2000);

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
            Alert.alert("Success", "PDF Saved to selected folder");

            // Also offer to open
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(result.uri, {
                mimeType: "application/pdf",
                UTI: "com.adobe.pdf",
                dialogTitle: "Open with...",
              });
            }
          }
        } catch (e) {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(result.uri, {
              mimeType: "application/pdf",
              UTI: "com.adobe.pdf",
              dialogTitle: "Open with...",
            });
          }
        }
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
          dialogTitle: "Open with...",
        });
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to download PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    try {
      const downloadUrl = resumeApi.getDownloadUrl(resume.id);
      if (Platform.OS === "web") {
        if (navigator.share) {
          await navigator.share({
            title: resume.originalFilename,
            url: downloadUrl,
          });
        } else {
          Alert.alert("Link Copied", "Download link copied to clipboard");
        }
        return;
      }

      const fileUri = FileSystem.documentDirectory + "CV.pdf";
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        fileUri,
      );
      const result = await downloadResumable.downloadAsync();

      if ((await Sharing.isAvailableAsync()) && result) {
        await Sharing.shareAsync(result.uri, { mimeType: "application/pdf" });
      }
    } catch (error) {
      Alert.alert("Error", "Failed to share resume");
    }
  };

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleShare}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityLabel="Share resume"
          hitSlop={10}
        >
          <Feather name="share-2" size={19} color={theme.primary} />
          <ThemedText
            style={[Typography.bodySmall, { color: theme.primary, fontWeight: "600" }]}
          >
            Share
          </ThemedText>
        </Pressable>
      ),
    });
  }, [navigation, theme]);

  return (
    <>
      <ScreenScrollView>
        <View style={styles.container}>
          <Card style={styles.infoCard}>
            <View style={styles.infoRow}>
              <ThemedText
                style={[Typography.bodySmall, { color: theme.textSecondary }]}
              >
                Filename
              </ThemedText>
              <ThemedText
                style={[Typography.body, styles.infoValue]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {resume.originalFilename}
              </ThemedText>
            </View>
            <View
              style={[
                styles.infoRow,
                { borderTopWidth: Hairline, borderTopColor: theme.border },
              ]}
            >
              <ThemedText
                style={[Typography.bodySmall, { color: theme.textSecondary }]}
              >
                Processed
              </ThemedText>
              <ThemedText style={Typography.body}>
                {resume.dateProcessed.toLocaleDateString()}
              </ThemedText>
            </View>
          </Card>

          <Pressable onPress={() => setShowPreview(true)}>
            <Card style={styles.contentCard}>
              <View style={{ alignItems: "center", padding: Spacing.md }}>
                <View
                  style={[
                    styles.previewIcon,
                    { backgroundColor: theme.primary + "15" },
                  ]}
                >
                  <Feather name="eye" size={24} color={theme.primary} />
                </View>
                <ThemedText
                  style={[
                    Typography.h3,
                    { marginTop: Spacing.md, textAlign: "center" },
                  ]}
                >
                  Preview Content
                </ThemedText>
                <ThemedText
                  style={[
                    Typography.bodySmall,
                    {
                      marginTop: Spacing.sm,
                      textAlign: "center",
                      color: theme.textSecondary,
                    },
                  ]}
                >
                  Tap to review the improved text before downloading.
                </ThemedText>
              </View>
            </Card>
          </Pressable>

          <View style={{ height: 100 }} />
        </View>
      </ScreenScrollView>

      <View
        style={[
          styles.downloadButtonContainer,
          { bottom: insets.bottom + Spacing.xl },
        ]}
      >
        <Pressable
          style={[
            styles.downloadButton,
            { backgroundColor: theme.primary },
            isDownloading && { opacity: 0.7 },
          ]}
          onPress={handleDownload}
          disabled={isDownloading}
        >
          <Feather
            name={isDownloading ? "loader" : "download"}
            size={20}
            color="#FFF"
          />
          <ThemedText
            style={[
              Typography.button,
              { color: "#FFF", marginLeft: Spacing.sm },
            ]}
          >
            {isDownloading ? "Downloading..." : "Download PDF"}
          </ThemedText>
        </Pressable>
      </View>

      <RatingModal
        visible={showRatingPrompt}
        onClose={() => setShowRatingPrompt(false)}
      />

      <Modal
        visible={showPreview}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View
          style={[
            styles.previewModalContainer,
            { backgroundColor: theme.backgroundRoot },
          ]}
        >
          <View
            style={[
              styles.previewModalHeader,
              { borderBottomColor: theme.border },
            ]}
          >
            <ThemedText style={Typography.h3}>Resume Preview</ThemedText>
            <Pressable
              onPress={() => setShowPreview(false)}
              style={styles.closeButton}
            >
              <Feather name="x" size={24} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.previewContent}>
            {(() => {
              try {
                const data =
                  typeof resume.improvedText === "string"
                    ? JSON.parse(resume.improvedText)
                    : resume.improvedText;
                return (
                  <View style={styles.previewPaper}>
                    <View style={styles.previewHeaderSection}>
                      <ThemedText
                        style={[Typography.h1, { textAlign: "center" }]}
                      >
                        {data.header.name}
                      </ThemedText>
                      <ThemedText
                        style={[
                          Typography.bodySmall,
                          { textAlign: "center", color: theme.textSecondary },
                        ]}
                      >
                        {[
                          data.header.location,
                          data.header.phone,
                          data.header.email,
                          data.header.linkedin,
                        ]
                          .filter(Boolean)
                          .join(" | ")}
                      </ThemedText>
                    </View>

                    <View style={styles.previewSection}>
                      <ThemedText style={styles.previewSectionTitle}>
                        WORK EXPERIENCE
                      </ThemedText>
                      <View
                        style={[
                          styles.previewDivider,
                          { backgroundColor: theme.border },
                        ]}
                      />
                      {data.experience.map((exp: any, idx: number) => (
                        <View key={idx} style={styles.previewItem}>
                          <View style={styles.previewItemHeader}>
                            <ThemedText style={Typography.h4}>
                              {exp.role}
                            </ThemedText>
                            <ThemedText
                              style={[
                                Typography.bodySmall,
                                { color: theme.textSecondary },
                              ]}
                            >
                              {exp.date}
                            </ThemedText>
                          </View>
                          <ThemedText
                            style={[
                              Typography.bodySmall,
                              { fontWeight: "600" },
                            ]}
                          >
                            {exp.company}
                          </ThemedText>
                          {exp.bullets.map((bullet: string, bidx: number) => (
                            <ThemedText key={bidx} style={styles.previewBullet}>
                              • {bullet}
                            </ThemedText>
                          ))}
                        </View>
                      ))}
                    </View>

                    <View style={styles.previewSection}>
                      <ThemedText style={styles.previewSectionTitle}>
                        EDUCATION
                      </ThemedText>
                      <View
                        style={[
                          styles.previewDivider,
                          { backgroundColor: theme.border },
                        ]}
                      />
                      {data.education.map((edu: any, idx: number) => (
                        <View key={idx} style={styles.previewItem}>
                          <View style={styles.previewItemHeader}>
                            <ThemedText style={Typography.h4}>
                              {edu.degree}
                            </ThemedText>
                            <ThemedText
                              style={[
                                Typography.bodySmall,
                                { color: theme.textSecondary },
                              ]}
                            >
                              {edu.date}
                            </ThemedText>
                          </View>
                          <ThemedText style={Typography.bodySmall}>
                            {edu.school}
                          </ThemedText>
                        </View>
                      ))}
                    </View>

                    <View style={styles.previewSection}>
                      <ThemedText style={styles.previewSectionTitle}>
                        SKILLS
                      </ThemedText>
                      <View
                        style={[
                          styles.previewDivider,
                          { backgroundColor: theme.border },
                        ]}
                      />
                      <ThemedText style={Typography.bodySmall}>
                        {data.skills}
                      </ThemedText>
                    </View>
                  </View>
                );
              } catch (e) {
                return (
                  <View style={{ padding: Spacing.xl, alignItems: "center" }}>
                    <ThemedText style={{ color: theme.textSecondary }}>
                      Error parsing resume content.
                    </ThemedText>
                  </View>
                );
              }
            })()}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

// ─── Screen styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.lg },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },

  infoCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  infoValue: { flexShrink: 1, textAlign: "right" },
  infoIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.full },

  previewCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    overflow: "hidden",
  },
  cvThumbnail: {
    padding: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  thumbNameLine: { marginBottom: 6 },
  thumbBar: { borderRadius: 3, marginBottom: 4 },
  thumbLine: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  thumbDivider: { height: 1, marginVertical: 8 },
  previewCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  previewEyeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  downloadContainer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
  },
  downloadButton: { height: Spacing.buttonHeight, borderRadius: BorderRadius.md, overflow: "hidden", ...Shadows.glow },
  downloadGradient: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },

  modalRoot: { flex: 1 },
  modalHeader: { borderBottomWidth: 1, paddingBottom: Spacing.md },
  modalHandleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CCC", alignSelf: "center", marginTop: Spacing.sm, marginBottom: Spacing.sm },
  modalHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: Spacing.lg },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  modalScrollContent: { padding: Spacing.lg, paddingBottom: 40 },

  cvPaper: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
    ...Shadows.small,
  },
  parseError: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
});

// ─── Preview modal styles ─────────────────────────────────────────────────────
const previewStyles = StyleSheet.create({
  headerBlock: { marginBottom: Spacing.xl },
  candidateName: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  contactLine: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    marginBottom: Spacing.md,
  },
  headerRule: { height: 1.5, borderRadius: 1 },

  section: { marginBottom: Spacing.lg },
  sectionHeadingRow: { marginBottom: Spacing.md },
  sectionHeadingText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  sectionRule: { height: 1, borderRadius: 1 },

  entry: { marginBottom: Spacing.md },
  entryTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 },
  entryTitle: { fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  entryDate: { fontSize: 11, flexShrink: 0 },
  entrySubtitle: { fontSize: 11, marginBottom: 6, fontStyle: "italic" },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 3 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, marginTop: 5, marginRight: 8, flexShrink: 0 },
  bulletText: { fontSize: 11, lineHeight: 16, flex: 1 },

  skillsText: { fontSize: 11, lineHeight: 18 },
});
