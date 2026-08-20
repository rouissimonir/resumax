import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useUser } from "@/contexts/UserContext";

export type Resume = {
  id: string;
  originalFilename: string;
  originalText: string;
  improvedText: string;
  dateProcessed: Date;
  status: "processing" | "completed" | "error";
  downloadUrl?: string;
  /**
   * The format this resume was generated with. Without it, the Preview screen
   * had nothing to send to generatePdf() and every download silently fell back
   * to the Harvard template — so picking "Executive Bold" then downloading gave
   * you a Harvard CV.
   */
  templateId: string;
  /** Whether a headshot is stored server-side for this job. */
  hasPhoto?: boolean;
};

/**
 * How long the backend keeps a job's render data.
 *
 * cleanup_old_files() sweeps uploads/ and outputs/ on a one-hour cycle, so
 * `downloadUrl` and the server-side debug.json that /api/generate-pdf reloads
 * both stop existing after that. History outlives them now that it's
 * persisted, so anything reading a stored entry must assume the server copy is
 * gone and offer a re-run rather than a download that 404s.
 */
export const SERVER_RETENTION_MS = 60 * 60 * 1000;

export function isServerCopyExpired(resume: Resume): boolean {
  const processed = resume.dateProcessed?.getTime?.();
  if (!processed || Number.isNaN(processed)) return true;
  return Date.now() - processed > SERVER_RETENTION_MS;
}

const STORAGE_PREFIX = "RESUMES_V1_";

/** Guest history lives under a fixed scope so a future sign-in can claim it. */
export const GUEST_STORAGE_KEY = `${STORAGE_PREFIX}guest`;

type ResumeContextType = {
  resumes: Resume[];
  addResume: (resume: Resume) => void;
  updateResume: (id: string, updates: Partial<Resume>) => void;
  deleteResume: (id: string) => void;
  clearAllResumes: () => void;
  getResumeById: (id: string) => Resume | undefined;
  currentProcessingId: string | null;
  setCurrentProcessingId: (id: string | null) => void;
  /** False until storage has been read, so History doesn't flash "empty". */
  isLoaded: boolean;
};

const ResumeContext = createContext<ResumeContextType | undefined>(undefined);

/**
 * JSON has no Date type, so a stored entry comes back with `dateProcessed` as
 * a string. Every screen that renders history calls .toLocaleDateString() on
 * it, which throws on a string — so revive it here rather than defensively at
 * each call site.
 */
function reviveResumes(raw: string): Resume[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r) => r && typeof r.id === "string")
    .map((r) => ({
      ...r,
      dateProcessed: new Date(r.dateProcessed),
      // A job that was mid-flight when the app was killed can never resume —
      // the server has no record of it. Land it as an error so it renders as
      // a dead entry the user can delete, not a spinner that never resolves.
      status: r.status === "processing" ? "error" : r.status,
    }));
}

export function ResumeProvider({ children }: { children: ReactNode }) {
  const { storageScope, isLoading: isUserLoading } = useUser();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(
    null,
  );
  const [isLoaded, setIsLoaded] = useState(false);

  const storageKey = `${STORAGE_PREFIX}${storageScope}`;

  /**
   * Which key the in-memory `resumes` actually came from. Writes are gated on
   * this matching the current key: without it, the render between "scope
   * changed" and "new scope's data loaded" would flush the *previous* user's
   * resumes into the *new* user's storage key.
   */
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Wait for UserContext to rehydrate first, otherwise this runs once
    // against the default "guest" scope and then again against the real one,
    // and the first pass writes an empty list over real data.
    if (isUserLoading) return;

    let cancelled = false;
    setIsLoaded(false);

    (async () => {
      let restored: Resume[] = [];
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) restored = reviveResumes(raw);
      } catch (e) {
        // Corrupt or unreadable history is not worth blocking the app for —
        // an empty list is a recoverable state, a crash loop isn't.
        console.error("Failed to load resume history", e);
      }
      if (cancelled) return;
      setResumes(restored);
      loadedKeyRef.current = storageKey;
      setIsLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey, isUserLoading]);

  useEffect(() => {
    if (!isLoaded || loadedKeyRef.current !== storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(resumes)).catch((e) =>
      console.error("Failed to persist resume history", e),
    );
  }, [resumes, storageKey, isLoaded]);

  const addResume = (resume: Resume) => {
    setResumes((prev) => [resume, ...prev]);
  };

  const updateResume = (id: string, updates: Partial<Resume>) => {
    setResumes((prev) =>
      prev.map((resume) =>
        resume.id === id ? { ...resume, ...updates } : resume,
      ),
    );
  };

  const deleteResume = (id: string) => {
    setResumes((prev) => prev.filter((resume) => resume.id !== id));
  };

  const clearAllResumes = () => {
    setResumes([]);
  };

  const getResumeById = (id: string) => {
    return resumes.find((resume) => resume.id === id);
  };

  return (
    <ResumeContext.Provider
      value={{
        resumes,
        addResume,
        updateResume,
        deleteResume,
        clearAllResumes,
        getResumeById,
        currentProcessingId,
        setCurrentProcessingId,
        isLoaded,
      }}
    >
      {children}
    </ResumeContext.Provider>
  );
}

export function useResumes() {
  const context = useContext(ResumeContext);
  if (context === undefined) {
    throw new Error("useResumes must be used within a ResumeProvider");
  }
  return context;
}
