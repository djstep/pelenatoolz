import type { ImportPreviewBlock } from "@/features/import/docx-blocks";

export type ImportFieldKey =
  | "location"
  | "characters"
  | "timing"
  | "scriptDay"
  | "intExt"
  | "dayNight"
  | "script";

export type ImportPreviewScene = {
  key: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  location?: string;
  intExt?: string;
  characters: string[];
  timing?: string;
  scriptDay?: number;
  dayNight?: string;
  script?: string;
  existingId?: string;
  old?: {
    location?: string;
    intExt?: string | null;
    characters: string[];
    timing?: string;
    scriptDay?: number | null;
    dayNight?: string | null;
    script?: string | null;
  };
};

export type ImportPreviewPayload = {
  scenes: ImportPreviewScene[];
  blocks?: ImportPreviewBlock[];
};

export type ImportActionState = {
  error?: string;
  success?: string;
  versionId?: string;
  preview?: {
    jobId: string;
    fileName: string;
    scenes: ImportPreviewScene[];
    blockCount?: number;
  };
};
