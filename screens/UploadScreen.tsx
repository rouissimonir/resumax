import React, { useState, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  Alert,
  Animated,
  Image,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";

import { RatingModal } from "@/components/RatingModal";
import { ScreenScrollView } from "@/components/ScreenScrollView";
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
import { useResumes } from "@/contexts/ResumeContext";
import { HomeStackParamList } from "@/navigation/HomeStackNavigator";
import { resumeApi, CVTemplate } from "@/services/resumeApi";
import { usePreferences } from "@/contexts/PreferencesContext";

type NavigationProp = NativeStackNavigationProp<HomeStackParamList, "Upload">;

const STEPS = [
  { title: "Upload", desc: "Pick your current resume as a PDF." },
  { title: "Improve", desc: "Wording, structure and keywords are rewritten." },
  { title: "Download", desc: "Export a clean, ATS-readable PDF." },
];

export default function UploadScreen() {
  const { preferences, isLoaded: prefsLoaded } = usePreferences();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const {
    addResume,
    updateResume,
    deleteResume,
    currentProcessingId,
    setCurrentProcessingId,
  } = useResumes();

  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    uri: string;
  } | null>(null);
  const [processingStage, setProcessingStage] = useState<string>("");
  const [templates, setTemplates] = useState<CVTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<string>("professional");
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [progress, setProgress] = useState<number>(0);

  const enterAnim = useRef(new Animated.Value(0)).current;

  // Templates are fetched on mount, but AsyncStorage resolves a tick later, so
  // the first loadTemplates() can run before the saved format is known. Apply
  // it once both are available. Guarded on prefsLoaded so the real default is
  // never overwritten by the pre-load placeholder value.
  useEffect(() => {
    if (!prefsLoaded || templates.length === 0) return;
    if (!preferences.preferredFormat) return;
    if (templates.some((t) => t.id === preferences.preferredFormat)) {
      setSelectedTemplate(preferences.preferredFormat);
    }
  }, [prefsLoaded, preferences.preferredFormat, templates]);

  useEffect(() => {
    loadTemplates();
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: Animations.slow,
      useNativeDriver: true,
    }).start();
  }, []);

  const loadTemplates = async () => {
    try {
      const response = await resumeApi.getTemplates();
      setTemplates(response.templates);
      if (response.templates.length > 0) {
        // Honour the saved format preference when it still exists server-side;
        // a preference naming a template this backend no longer ships must not
        // leave the picker empty.
        const preferred = response.templates.find(
          (t) => t.id === preferences.preferredFormat,
        );
        setSelectedTemplate(preferred ? preferred.id : response.templates[0].id);
      }
    } catch (error) {
      console.error("Failed to load templates:", error);
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      setSelectedFile({ name: file.name, uri: file.uri });
    } catch (error) {
      Alert.alert("Error", "Could not open that file.");
    }
  };

  const processResume = async () => {
    if (!selectedFile) return;

    const tempId = Date.now().toString();
    setCurrentProcessingId(tempId);
    setProgress(0);
    setProcessingStage("Starting…");

    addResume({
      id: tempId,
      originalFilename: selectedFile.name,
      originalText: "",
      improvedText: "",
      dateProcessed: new Date(),
      status: "processing",
    });

    try {
      setProgress(10);
      setProcessingStage("Uploading your resume");

      const progressSteps = [
        { progress: 25, message: "Extracting the text" },
        { progress: 40, message: "Reading scanned pages" },
        { progress: 60, message: "Rewriting your content" },
        { progress: 80, message: "Formatting the document" },
      ];

      let currentStep = 0;
      const progressInterval = setInterval(() => {
        if (currentStep < progressSteps.length) {
          const step = progressSteps[currentStep];
          setProgress(step.progress);
          setProcessingStage(step.message);
          currentStep++;
        }
      }, 1500);

      const response = await resumeApi.uploadResume(
        selectedFile.uri,
        selectedFile.name,
        selectedTemplate,
        null,
        {
          cvLanguage: preferences.cvLanguage,
          targetRole: preferences.targetRole,
          experienceLevel: preferences.experienceLevel,
        },
      );
      clearInterval(progressInterval);
      setProgress(100);
      setProcessingStage("Done");

      deleteResume(tempId);
      addResume({
        id: response.id,
        originalFilename: selectedFile.name,
        originalText: response.original_text,
        improvedText:
          typeof response.improved_data === "string"
            ? response.improved_data
            : JSON.stringify(response.improved_data),
        dateProcessed: new Date(),
        status: "completed",
        downloadUrl: response.download_url,
      });

      setCurrentProcessingId(null);
      setSelectedFile(null);
      navigation.navigate("Preview", { resumeId: response.id });
    } catch (error) {
      console.error("Error processing resume:", error);
      updateResume(tempId, { status: "error" });
      setCurrentProcessingId(null);
      Alert.alert(
        "Couldn't process that file",
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  const activeTemplate = templates.find((t) => t.id === selectedTemplate);

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
          <View style={styles.intro}>
            <ThemedText type="h1">Improve a resume</ThemedText>
            <ThemedText tone="secondary" style={{ marginTop: Spacing.xs }}>
              Upload a PDF and get back a cleaner, ATS-readable version.
            </ThemedText>
          </View>

          {/* Drop zone */}
          {!selectedFile && (
            <Pressable
              onPress={pickDocument}
              style={({ pressed }) => [
                styles.dropzone,
                {
                  borderColor: pressed ? theme.text : theme.border,
                  backgroundColor: pressed
                    ? theme.backgroundSecondary
                    : theme.backgroundDefault,
                },
              ]}
            >
              <Feather name="file-plus" size={22} color={theme.textSecondary} />
              <ThemedText type="h4" style={{ marginTop: Spacing.md }}>
                Choose a PDF
              </ThemedText>
              <ThemedText tone="muted" type="bodySmall" style={{ marginTop: 2 }}>
                Up to 10 pages
              </ThemedText>
            </Pressable>
          )}

          {selectedFile && (
            <View>
              {/* Selected file */}
              <View style={[styles.group, { borderColor: theme.border }]}>
                <View style={styles.fileRow}>
                  <Feather name="file-text" size={18} color={theme.text} />
                  <View style={styles.fileText}>
                    <ThemedText type="h4" numberOfLines={1}>
                      {selectedFile.name}
                    </ThemedText>
                    <ThemedText tone="muted" type="small">
                      Ready to process
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => setSelectedFile(null)}
                    hitSlop={10}
                    style={({ pressed }) =>
                      pressed && { opacity: PressedOpacity }
                    }
                  >
                    <Feather name="x" size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
              </View>

              {/* Templates */}
              {templates.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <ThemedText type="overline" tone="muted">
                      TEMPLATE
                    </ThemedText>
                    <Pressable
                      onPress={() => setShowTemplatePreview(true)}
                      hitSlop={8}
                      style={({ pressed }) =>
                        pressed && { opacity: PressedOpacity }
                      }
                    >
                      <ThemedText type="caption">View full size</ThemedText>
                    </Pressable>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.templateScroll}
                  >
                    {templates.map((template) => {
                      const active = selectedTemplate === template.id;
                      return (
                        <Pressable
                          key={template.id}
                          onPress={() => setSelectedTemplate(template.id)}
                          style={styles.templateItem}
                        >
                          <View
                            style={[
                              styles.templateThumb,
                              {
                                borderColor: active
                                  ? theme.text
                                  : theme.border,
                                backgroundColor: theme.backgroundDefault,
                              },
                            ]}
                          >
                            <Image
                              source={{ uri: template.preview_image }}
                              style={styles.templateImage}
                              resizeMode="cover"
                            />
                            {active && (
                              <View
                                style={[
                                  styles.templateCheck,
                                  { backgroundColor: theme.primary },
                                ]}
                              >
                                <Feather
                                  name="check"
                                  size={10}
                                  color={theme.buttonText}
                                />
                              </View>
                            )}
                          </View>
                          <ThemedText
                            type="caption"
                            tone={active ? "default" : "muted"}
                            numberOfLines={1}
                            style={styles.templateName}
                          >
                            {template.name}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <Pressable
                onPress={processResume}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  pressed && { opacity: 0.88 },
                ]}
              >
                <ThemedText
                  style={[Typography.button, { color: theme.buttonText }]}
                >
                  Improve resume
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* How it works */}
          {!selectedFile && (
            <View style={styles.section}>
              <ThemedText type="overline" tone="muted">
                HOW IT WORKS
              </ThemedText>
              <View
                style={[
                  styles.group,
                  { borderColor: theme.border, marginTop: Spacing.md },
                ]}
              >
                {STEPS.map((item, i) => (
                  <View
                    key={item.title}
                    style={[
                      styles.stepRow,
                      i > 0 && {
                        borderTopWidth: Hairline,
                        borderTopColor: theme.border,
                      },
                    ]}
                  >
                    <ThemedText tone="muted" type="caption" style={styles.stepNo}>
                      {i + 1}
                    </ThemedText>
                    <View style={styles.stepBody}>
                      <ThemedText type="h4">{item.title}</ThemedText>
                      <ThemedText
                        tone="secondary"
                        type="bodySmall"
                        style={{ marginTop: 1 }}
                      >
                        {item.desc}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Low-key rating ask */}
          <Pressable
            onPress={() => setShowRatingModal(true)}
            style={({ pressed }) => [
              styles.rateRow,
              { borderTopColor: theme.border },
              pressed && { opacity: PressedOpacity },
            ]}
          >
            <ThemedText tone="secondary" type="bodySmall" style={{ flex: 1 }}>
              Enjoying Resumax? Leave a rating
            </ThemedText>
            <Feather name="arrow-up-right" size={15} color={theme.textMuted} />
          </Pressable>
        </Animated.View>
      </ScreenScrollView>

      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
      />

      {/* Processing */}
      <Modal visible={currentProcessingId !== null} transparent animationType="fade">
        <View style={styles.overlay}>
          <View
            style={[
              styles.processingCard,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.processingHead}>
              <ActivityIndicator size="small" color={theme.text} />
              <ThemedText type="h3" style={{ marginLeft: Spacing.md }}>
                Working on it
              </ThemedText>
            </View>

            <View
              style={[
                styles.track,
                { backgroundColor: theme.backgroundTertiary },
              ]}
            >
              <View
                style={[
                  styles.fill,
                  { backgroundColor: theme.text, width: `${progress}%` },
                ]}
              />
            </View>

            <View style={styles.processingFoot}>
              <ThemedText tone="secondary" type="bodySmall" style={{ flex: 1 }}>
                {processingStage}
              </ThemedText>
              <ThemedText tone="muted" type="bodySmall">
                {progress}%
              </ThemedText>
            </View>
          </View>
        </View>
      </Modal>

      {/* Template preview */}
      <Modal
        visible={showTemplatePreview}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTemplatePreview(false)}
      >
        <View style={[styles.modal, { backgroundColor: theme.backgroundRoot }]}>
          <View
            style={[styles.modalHeader, { borderBottomColor: theme.border }]}
          >
            <ThemedText type="h3">
              {activeTemplate?.name || "Template"}
            </ThemedText>
            <Pressable
              onPress={() => setShowTemplatePreview(false)}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: PressedOpacity }}
            >
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <View
              style={[
                styles.largePreviewFrame,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundDefault,
                },
              ]}
            >
              <Image
                source={{ uri: activeTemplate?.preview_image }}
                style={styles.largePreviewImage}
                resizeMode="contain"
              />
            </View>

            <ThemedText tone="secondary" style={{ marginTop: Spacing.lg }}>
              {activeTemplate?.description ||
                "A professional, ATS-optimised template suitable for most industries."}
            </ThemedText>

            <Pressable
              onPress={() => setShowTemplatePreview(false)}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary, marginTop: Spacing.xl },
                pressed && { opacity: 0.88 },
              ]}
            >
              <ThemedText
                style={[Typography.button, { color: theme.buttonText }]}
              >
                Use this template
              </ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing["2xl"],
  },
  intro: {
    marginBottom: Spacing.xl,
  },
  section: {
    marginTop: Spacing.xl,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },

  dropzone: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing["3xl"],
    alignItems: "center",
    justifyContent: "center",
  },

  group: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
  },
  fileText: {
    flex: 1,
    marginHorizontal: Spacing.md,
  },

  templateScroll: {
    gap: Spacing.md,
    paddingRight: Spacing.lg,
  },
  templateItem: {
    width: 88,
  },
  templateThumb: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
    height: 112,
  },
  templateImage: {
    width: "100%",
    height: "100%",
  },
  templateCheck: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  templateName: {
    marginTop: Spacing.sm,
  },

  primaryButton: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xl,
  },

  stepRow: {
    flexDirection: "row",
    padding: Spacing.lg,
  },
  stepNo: {
    width: 18,
    marginTop: 2,
  },
  stepBody: {
    flex: 1,
  },

  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing["2xl"],
    paddingTop: Spacing.lg,
    borderTopWidth: Hairline,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  processingCard: {
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  processingHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.lg,
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
  processingFoot: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
  },

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
  largePreviewFrame: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
  },
  largePreviewImage: {
    width: "100%",
    height: 420,
  },
});
