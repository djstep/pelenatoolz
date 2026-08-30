import type { ScriptCommentStatus } from "@prisma/client";

export type ScriptCommentRow = {
  id: string;
  scriptVersionId: string;
  startBlockId: string;
  endBlockId: string;
  rangeStart: number;
  rangeEnd: number;
  content: string;
  status: ScriptCommentStatus;
  parentCommentId: string | null;
  createdAt: string;
  author: { id: string; name: string };
};

export type ScriptCommentThread = ScriptCommentRow & {
  replies: ScriptCommentRow[];
};

export function groupCommentThreads(rows: ScriptCommentRow[]): ScriptCommentThread[] {
  const roots = rows.filter((row) => !row.parentCommentId);
  const repliesByParent = new Map<string, ScriptCommentRow[]>();

  for (const row of rows) {
    if (!row.parentCommentId) continue;
    const list = repliesByParent.get(row.parentCommentId) ?? [];
    list.push(row);
    repliesByParent.set(row.parentCommentId, list);
  }

  return roots.map((root) => ({
    ...root,
    replies: repliesByParent.get(root.id) ?? [],
  }));
}
