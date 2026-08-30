import type { ScriptVersionSourceType } from "@prisma/client";

export type ScriptVersionRow = {
  id: string;
  projectId: string;
  versionNumber: number;
  title: string | null;
  note: string | null;
  isCurrent: boolean;
  isLocked: boolean;
  sourceType: ScriptVersionSourceType;
  sourceVersionId: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
};

export type ScriptVersionOverviewRow = ScriptVersionRow & {
  timingLabel: string;
  timingPages?: number;
};
