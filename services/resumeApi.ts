import Constants from "expo-constants";

/**
 * Last-resort backend URL for a release build.
 *
 * Builds normally get this from EXPO_PUBLIC_API_URL, which eas.json sets for
 * the preview and production profiles. This constant only matters when that
 * env var is somehow absent — and it used to be "http://localhost:8000",
 * which meant a misconfigured release build would silently try to reach a
 * server on the phone itself. iOS App Transport Security also blocks
 * cleartext http:// outright, so the failure surfaced as an opaque network
 * error rather than anything diagnosable. Pointing it at the real host makes
 * a missing env var a non-event instead of a broken release.
 */
const PRODUCTION_API_URL = "https://resumee-nhrs.onrender.com";

const getBaseUrl = () => {
  // 1. Check for environment variable first (set in eas.json for builds)
  if (process.env.EXPO_PUBLIC_API_URL) {
    console.log("📡 Using EXPO_PUBLIC_API_URL:", process.env.EXPO_PUBLIC_API_URL);
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2. For development in Expo Go - use local backend
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    const ip = debuggerHost.split(":")[0];
    console.log("📡 Using Expo Go development URL:", `http://${ip}:8000`);
    return `http://${ip}:8000`;
  }

  // 3. For web development (localhost)
  if (typeof window !== "undefined" && window.location) {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      console.log("📡 Using localhost for web development");
      return "http://localhost:8000";
    }
  }

  // 4. Default: Production URL (for APK/AAB builds)
  console.log("📡 Using production URL:", PRODUCTION_API_URL);
  return PRODUCTION_API_URL;
};

const API_BASE_URL = getBaseUrl();

// Log the API URL for debugging
console.log("🔗 API Base URL:", API_BASE_URL);

export interface UploadResumeResponse {
  id: string;
  original_filename: string;
  timestamp: string;
  original_text: string;
  improved_data: any; // JSON object with structured resume data
  download_url: string;
}

/** Whether a format will render a supplied headshot. */
export type PhotoPolicy = "none" | "optional" | "expected";

/** Region a format targets. null = a general-purpose visual style. */
export type TemplateRegion = "eu" | "us_ca" | "uk" | "de" | null;

export interface CVTemplate {
  id: string;
  name: string;
  description: string;
  preview_image: string;
  // Added alongside the regional formats. Optional so that a backend which
  // predates them (or an app build talking to an older server) still works.
  region?: TemplateRegion;
  photo?: PhotoPolicy;
  badge?: string | null;
}

export interface TemplatesResponse {
  templates: CVTemplate[];
}

/**
 * Render's free tier spins the backend down after inactivity, so the first
 * request after a while can take 30s+ to answer (the "cold start"). Templates
 * are the first thing almost every screen needs, so we kick this fetch off
 * once at module load — as soon as the JS bundle evaluates, well before any
 * screen mounts and asks for it — and every caller shares that one in-flight
 * request instead of triggering (and waiting on) their own.
 */
let templatesRequest: Promise<TemplatesResponse> | null = null;

async function fetchTemplates(): Promise<TemplatesResponse> {
  console.log(
    "📡 Fetching templates from:",
    `${API_BASE_URL}/api/templates`,
  );
  const response = await fetch(`${API_BASE_URL}/api/templates`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch templates: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  // Prepend base URL to preview images if they are relative paths
  if (data.templates) {
    data.templates = data.templates.map((t: any) => ({
      ...t,
      preview_image: t.preview_image.startsWith("/")
        ? `${API_BASE_URL}${t.preview_image}`
        : t.preview_image,
    }));
  }

  console.log("✅ Templates loaded:", data);
  return data;
}

export const resumeApi = {
  /**
   * Fetches the template list, reusing an in-flight/succeeded request (see
   * `prefetchTemplates` below) so screens don't each pay for their own
   * roundtrip. A failed request is not cached — the next call (e.g. an
   * automatic retry) starts a fresh one.
   */
  async getTemplates(): Promise<TemplatesResponse> {
    if (!templatesRequest) {
      templatesRequest = fetchTemplates().catch((error) => {
        templatesRequest = null;
        console.error("❌ Failed to fetch templates:", error);
        throw error;
      });
    }
    return templatesRequest;
  },

  /**
   * Fire the templates request as early as possible (app startup) to absorb
   * the Render cold-start latency while the splash/onboarding is on screen,
   * rather than when the user actually reaches the upload/profile screens.
   * Fire-and-forget: errors are swallowed here and surface normally to
   * whichever screen later calls `getTemplates()`.
   */
  prefetchTemplates(): void {
    resumeApi.getTemplates().catch(() => {});
  },

  async uploadResume(
    fileUri: string,
    fileName: string,
    templateId: string = "professional",
    photoUri?: string | null,
    /**
     * Saved CV preferences. Optional so existing call sites keep working; when
     * omitted the backend behaves exactly as it did before they existed.
     */
    prefs?: {
      cvLanguage?: string;
      targetRole?: string;
      experienceLevel?: string;
    } | null,
  ): Promise<UploadResumeResponse> {
    try {
      console.log("📤 Uploading resume:", fileName);
      const formData = new FormData();

      // For web
      if (fileUri.startsWith("blob:") || fileUri.startsWith("data:")) {
        const response = await fetch(fileUri);
        const blob = await response.blob();
        formData.append("file", blob, fileName);
      } else {
        // For mobile
        formData.append("file", {
          uri: fileUri,
          type: "application/pdf",
          name: fileName,
        } as any);
      }

      formData.append("template_id", templateId);

      // Only send fields the user actually set. "auto"/empty is the unset
      // state and is deliberately omitted rather than sent as a literal.
      if (prefs?.cvLanguage && prefs.cvLanguage !== "auto") {
        formData.append("language", prefs.cvLanguage);
      }
      if (prefs?.targetRole?.trim()) {
        formData.append("target_role", prefs.targetRole.trim());
      }
      if (prefs?.experienceLevel) {
        formData.append("experience_level", prefs.experienceLevel);
      }

      // Sent with the resume rather than separately: file_id doesn't exist
      // until this call returns, and generate-pdf is Pro-gated, so this is the
      // only way a free user sees their photo in the first render.
      if (photoUri) {
        if (photoUri.startsWith("blob:") || photoUri.startsWith("data:")) {
          const blob = await (await fetch(photoUri)).blob();
          formData.append("photo", blob, "photo.jpg");
        } else {
          formData.append("photo", {
            uri: photoUri,
            type: "image/jpeg",
            name: "photo.jpg",
          } as any);
        }
      }

      console.log(
        "🚀 Sending request to:",
        `${API_BASE_URL}/api/upload-resume`,
      );

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes timeout

      const response = await fetch(`${API_BASE_URL}/api/upload-resume`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        throw new Error(
          error.detail || `Failed to upload resume: ${response.status}`,
        );
      }

      const data = await response.json();
      console.log("✅ Resume processed successfully");
      return data;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            "Request timeout - processing took too long. Please try again.",
          );
        }
        console.error("❌ Upload error:", error.message);
      }
      throw error;
    }
  },

  async downloadResume(fileId: string): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/api/download/${fileId}`);

    if (!response.ok) {
      throw new Error("Failed to download resume");
    }

    return response.blob();
  },

  getDownloadUrl(fileId: string): string {
    return `${API_BASE_URL}/api/download/${fileId}`;
  },

  getTemplatePreviewUrl(templateId: string): string {
    return `${API_BASE_URL}/api/template-preview/${templateId}`;
  },

  async getProgress(
    fileId: string,
  ): Promise<{ stage: string; message: string; progress: number }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/progress/${fileId}`);
      if (!response.ok) {
        throw new Error("Failed to get progress");
      }
      return await response.json();
    } catch (error) {
      console.error("Failed to get progress:", error);
      return { stage: "unknown", message: "Processing...", progress: 0 };
    }
  },

  async uploadPhoto(fileId: string, photoUri: string): Promise<void> {
    const formData = new FormData();
    formData.append("file_id", fileId);
    if (photoUri.startsWith("blob:") || photoUri.startsWith("data:")) {
      const blob = await (await fetch(photoUri)).blob();
      formData.append("photo", blob, "photo.jpg");
    } else {
      formData.append("photo", {
        uri: photoUri,
        type: "image/jpeg",
        name: "photo.jpg",
      } as any);
    }

    const response = await fetch(`${API_BASE_URL}/api/upload-photo`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to upload photo" }));
      throw new Error(error.detail);
    }
  },

  async deletePhoto(fileId: string): Promise<void> {
    await fetch(`${API_BASE_URL}/api/photo/${fileId}`, { method: "DELETE" });
  },

  async generatePdf(
    fileId: string,
    userId: string,
    templateId: string = "professional",
  ): Promise<{ download_url: string }> {
    const response = await fetch(`${API_BASE_URL}/api/generate-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_id: fileId,
        user_id: userId,
        template_id: templateId,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to generate PDF" }));
      throw new Error(error.detail);
    }

    return await response.json();
  },
};
