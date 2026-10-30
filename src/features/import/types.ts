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
