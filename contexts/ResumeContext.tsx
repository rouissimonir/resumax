import React, { createContext, useContext, useState, ReactNode } from "react";

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

type ResumeContextType = {
  resumes: Resume[];
  addResume: (resume: Resume) => void;
  updateResume: (id: string, updates: Partial<Resume>) => void;
  deleteResume: (id: string) => void;
  clearAllResumes: () => void;
  getResumeById: (id: string) => Resume | undefined;
  currentProcessingId: string | null;
  setCurrentProcessingId: (id: string | null) => void;
};

const ResumeContext = createContext<ResumeContextType | undefined>(undefined);

export function ResumeProvider({ children }: { children: ReactNode }) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(
    null,
  );

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
