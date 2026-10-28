"use client";

import { ScriptBlockType, type TimingMode } from "@prisma/client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createScriptCommentAction,
  deleteScriptCommentAction,
  listScriptCommentsAction,
  replyScriptCommentAction,
  resolveScriptCommentAction,
  saveScreenplayVersionAction,
  type ScreenplayActionState,
} from "@/features/screenplay/actions";
import { ScreenplayActionSidebar } from "@/features/screenplay/components/screenplay-action-sidebar";
import { ScreenplayBlockCommentAnchor } from "@/features/screenplay/components/screenplay-block-comment-anchor";
import { ScreenplayBlockRow } from "@/features/screenplay/components/screenplay-block-row";
import { ScreenplayCommentsMargin } from "@/features/screenplay/components/screenplay-comments-margin";
import { ScreenplayFormatToolbar } from "@/features/screenplay/components/screenplay-format-toolbar";
import {
  createEmptyBlock,
  type ScreenplayBlock,
} from "@/features/screenplay/lib/block-types";
import { blocksAreEqual } from "@/features/screenplay/lib/block-snapshot";
import {
  groupCommentThreads,
  type ScriptCommentRow,
} from "@/features/screenplay/lib/comment-types";
import { computePageBreaks, estimateTotalPages } from "@/features/screenplay/lib/page-layout";
import { reformatScreenplayBlocks } from "@/features/screenplay/lib/reformat-blocks";
import {
  estimateScreenplayTiming,
  timingModeHint,
  type SceneTimingRef,
} from "@/features/screenplay/lib/timing";
import { useBlockHistory } from "@/features/screenplay/lib/use-block-history";
import { parseSlugline } from "@/features/screenplay/lib/slugline";
import { cn } from "@/shared/lib/cn";
import { useActionToast } from "@/shared/ui/toast";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";

type Option = { id: string; name: string };

type Props = {
  projectId: string;
  versionId: string;
  initialBlocks: ScreenplayBlock[];
  initialComments?: ScriptCommentRow[];
  characters: Option[];
  locations: Option[];
  timingMode: TimingMode;
  pageToMinuteRatio: number;
  sceneTimings?: SceneTimingRef[];
  scrollToSceneId?: string | null;
  canWrite: boolean;
  timingSaving?: boolean;
  onTimingModeChange?: (mode: TimingMode) => void;
  onPageToMinuteRatioChange?: (ratio: number) => void;
  onPageToMinuteRatioBlur?: () => void;
  isFullscreen?: boolean;
  onCreateCharacter?: (name: string) => Promise<Option | null>;
  onCreateLocation?: (name: string) => Promise<Option | null>;
  onRequestSave?: (blocks: ScreenplayBlock[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onToggleFullscreen?: () => void;
  sidebarExports?: {
    exporting: string | null;
    pending: boolean;
    onLibretto: () => void;
    onExportFountain: () => void;
    onExportDocx: () => void;
    onExportPdf: () => void;
  };
};

function normalizeBlocks(blocks: ScreenplayBlock[]) {
  return blocks.map((block, index) => ({ ...block, sortOrder: index }));
}

type PendingSelection = {
  startBlockId: string;
  endBlockId: string;
  rangeStart: number;
  rangeEnd: number;
  quote: string;
};

function captureTextSelection(): PendingSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  const startEl = (
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement)
  )?.closest("[data-block-id]");
  const endEl = (
    range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : (range.endContainer as HTMLElement)
  )?.closest("[data-block-id]");

  if (!startEl || !endEl) return null;

  const startBlockId = startEl.getAttribute("data-block-id");
  const endBlockId = endEl.getAttribute("data-block-id");
  if (!startBlockId || !endBlockId) return null;

  return {
    startBlockId,
    endBlockId,
    rangeStart: range.startOffset,
    rangeEnd: range.endOffset,
    quote: sel.toString().slice(0, 200),
  };
}

export function ScreenplayBlockEditor({
  projectId,
  versionId,
  initialBlocks,
  initialComments = [],
  characters,
  locations,
  timingMode,
  pageToMinuteRatio,
  sceneTimings = [],
  scrollToSceneId = null,
  canWrite,
  timingSaving = false,
  onTimingModeChange,
  onPageToMinuteRatioChange,
  onPageToMinuteRatioBlur,
  isFullscreen = false,
  onCreateCharacter,
  onCreateLocation,
  onRequestSave,
  onDirtyChange,
  onToggleFullscreen,
  sidebarExports,
}: Props) {
  const baselineBlocks = useMemo(() => normalizeBlocks(initialBlocks), [initialBlocks]);

  const {
    blocks,
    setBlocks,
    resetHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useBlockHistory(baselineBlocks);

  const [activeIndex, setActiveIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<ScreenplayActionState>({});
  const confirmDelete = useConfirm();
  useActionToast(message);
  const [pending, startTransition] = useTransition();
  const [comments, setComments] = useState(initialComments);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [paperColumnEl, setPaperColumnEl] = useState<HTMLDivElement | null>(
    null,
  );
  const activeEditorRef = useRef<HTMLDivElement | null>(null);

  const isDirty = useMemo(
    () => !blocksAreEqual(blocks, baselineBlocks),
    [blocks, baselineBlocks],
  );

  useEffect(() => {
    resetHistory(baselineBlocks);
  }, [baselineBlocks, resetHistory]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!scrollToSceneId) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-scene-id="${scrollToSceneId}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("screenplay-scene-highlight");
      window.setTimeout(() => el.classList.remove("screenplay-scene-highlight"), 2400);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [scrollToSceneId, blocks]);

  // Несохранённый текст — в общем механизме: переход по меню и закрытие вкладки спросят.
  // «Сохранить» в вопросе о переходе пишет в эту же версию; ошибка — сообщением редактора.
  // Только при canWrite: страница версии даёт его при праве на сценарий и незаблокированной
  // версии (isLocked), — у заблокированной в вопросе лишь «Остаться» / «Не сохранять».
  const unsaved = useUnsavedChanges();
  const dirtyRef = useRef(isDirty);
  const saveOnLeaveRef = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);
  useEffect(() => {
    saveOnLeaveRef.current = async () => {
      const result = await saveScreenplayVersionAction(
        projectId,
        versionId,
        "same",
        JSON.stringify({ blocks }),
      );
      setMessage(result);
      return !result.error;
    };
  });
  useEffect(
    () =>
      unsaved.register(
        () => dirtyRef.current,
        canWrite ? () => saveOnLeaveRef.current() : undefined,
      ),
    [unsaved, canWrite],
  );

  const visibleBlocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return blocks.map((block, index) => ({ block, index }));
    return blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) =>
        `${block.content} ${block.contentHtml ?? ""}`.toLowerCase().includes(q),
      );
  }, [blocks, search]);

  const timing = useMemo(
    () =>
      estimateScreenplayTiming(
        blocks,
        timingMode,
        pageToMinuteRatio,
        sceneTimings,
      ),
    [blocks, timingMode, pageToMinuteRatio, sceneTimings],
  );

  const pageCount = useMemo(() => estimateTotalPages(blocks), [blocks]);
  const pageBreaks = useMemo(() => computePageBreaks(blocks), [blocks]);
  const pageBreakSet = useMemo(
    () => new Set(pageBreaks.map((b) => b.afterBlockIndex)),
    [pageBreaks],
  );

  const commentThreads = useMemo(
    () => groupCommentThreads(comments),
    [comments],
  );

  const blocksWithOpenComments = useMemo(() => {
    const ids = new Set<string>();
    for (const thread of commentThreads) {
      if (thread.status !== "OPEN") continue;
      ids.add(thread.startBlockId);
      if (thread.endBlockId !== thread.startBlockId) {
        ids.add(thread.endBlockId);
      }
    }
    return ids;
  }, [commentThreads]);

  const refreshComments = useCallback(async () => {
    const result = await listScriptCommentsAction(projectId, versionId);
    if ("comments" in result && result.comments) {
      setComments(result.comments);
    }
  }, [projectId, versionId]);

  const updateBlock = useCallback(
    (index: number, patch: Partial<ScreenplayBlock>) => {
      setBlocks((prev) =>
        normalizeBlocks(
          prev.map((block, i) => (i === index ? { ...block, ...patch } : block)),
        ),
      );
    },
    [setBlocks],
  );

  const insertBlock = useCallback(
    (index: number, type: ScriptBlockType) => {
      const scene = blocks[index]?.sceneId ?? null;
      setBlocks((prev) => {
        const next = [...prev];
        next.splice(index + 1, 0, createEmptyBlock(type, index + 1, scene));
        return normalizeBlocks(next);
      });
      setActiveIndex(index + 1);
      window.setTimeout(() => activeEditorRef.current?.focus(), 0);
    },
    [blocks, setBlocks],
  );

  const removeBlock = useCallback(
    (index: number) => {
      if (blocks.length <= 1) return;
      setBlocks((prev) => normalizeBlocks(prev.filter((_, i) => i !== index)));
      setActiveIndex((value) => Math.max(0, value - 1));
    },
    [blocks.length, setBlocks],
  );

  const handleSave = () => {
    const payload = blocks;

    if (onRequestSave) {
      onRequestSave(payload);
      return;
    }

    startTransition(async () => {
      const result = await saveScreenplayVersionAction(
        projectId,
        versionId,
        "same",
        JSON.stringify({ blocks: payload }),
      );
      setMessage(result);
    });
  };

  const characterNames = useMemo(
    () => new Set(characters.map((c) => c.name.toLowerCase())),
    [characters],
  );
  const locationNames = useMemo(
    () => new Set(locations.map((l) => l.name.toLowerCase())),
    [locations],
  );

  const handleCharacterBlur = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !onCreateCharacter) return;
      if (characterNames.has(trimmed.toLowerCase())) return;
      await onCreateCharacter(trimmed);
    },
    [characterNames, onCreateCharacter],
  );

  const handleSluglineBlur = useCallback(
    async (content: string) => {
      if (!onCreateLocation) return;
      const parsed = parseSlugline(content);
      const location = parsed?.location.trim();
      if (!location || locationNames.has(location.toLowerCase())) return;
      await onCreateLocation(location);
    },
    [locationNames, onCreateLocation],
  );

  const applyFormat = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    activeEditorRef.current?.focus();
  }, []);

  const handleReformat = useCallback(() => {
    const sel = window.getSelection();
    let from: number | undefined;
    let to: number | undefined;

    if (sel && !sel.isCollapsed) {
      const startEl = sel.anchorNode?.parentElement?.closest("[data-block-index]");
      const endEl = sel.focusNode?.parentElement?.closest("[data-block-index]");
      if (startEl && endEl) {
        from = Number(startEl.getAttribute("data-block-index"));
        to = Number(endEl.getAttribute("data-block-index"));
        if (from > to) [from, to] = [to, from];
      }
    }

    setBlocks((prev) =>
      normalizeBlocks(reformatScreenplayBlocks(prev, from, to)),
    );
  }, [setBlocks]);

  const handleAddCommentClick = useCallback((blockIndex?: number) => {
    const captured = captureTextSelection();
    if (captured) {
      setPendingSelection(captured);
      return;
    }
    const index = blockIndex ?? activeIndex;
    const block = blocks[index];
    if (!block) return;
    setPendingSelection({
      startBlockId: block.id,
      endBlockId: block.id,
      rangeStart: 0,
      rangeEnd: block.content.length,
      quote: block.content.slice(0, 120),
    });
  }, [activeIndex, blocks]);

  const timingHint = timingModeHint(timingMode, pageToMinuteRatio);

  const activeBlock = blocks[activeIndex];
  const anchorBlockId =
    pendingSelection?.startBlockId ?? activeBlock?.id ?? null;
  const isComposing =
    pendingSelection !== null &&
    pendingSelection.startBlockId === anchorBlockId;

  const editorContent = (
    <div
      className={cn(
        "screenplay-editor-shell",
        isFullscreen && "screenplay-editor-shell--fullscreen",
      )}
    >
      <div className="screenplay-editor-main">
        <div className="screenplay-editor-column">
          <div
            className={cn(
              "screenplay-editor-document",
              (commentThreads.length > 0 || isComposing) &&
                "screenplay-editor-document--with-comments",
            )}
          >
            <div
              ref={setPaperColumnEl}
              className="screenplay-editor-paper-column"
            >
              <div className="screenplay-format-toolbar-sticky">
                <ScreenplayFormatToolbar
                  activeType={blocks[activeIndex]?.type ?? "ACTION"}
                  canWrite={canWrite}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  isFullscreen={isFullscreen}
                  onTypeChange={(type) => {
                    if (activeIndex >= 0) updateBlock(activeIndex, { type });
                  }}
                  onFormat={applyFormat}
                  onUndo={undo}
                  onRedo={redo}
                  onReformat={handleReformat}
                  onToggleFullscreen={() => onToggleFullscreen?.()}
                />
              </div>

              <div
                className={cn(
                  "screenplay-editor-paper rounded-xl border border-[var(--border)] bg-[var(--surface-3)] p-6",
                  "screenplay-editor-paper--paged",
                )}
              >
            {visibleBlocks.length === 0 ? (
              <p className="text-sm text-[var(--muted-fg)]">
                Нет блоков для отображения.
              </p>
            ) : (
              visibleBlocks.map(({ block, index }) => (
                <div key={block.id}>
                  <ScreenplayBlockRow
                    block={block}
                    index={index}
                    active={index === activeIndex}
                    canWrite={canWrite}
                    hasOpenComments={blocksWithOpenComments.has(block.id)}
                    onFocus={() => {
                      setActiveIndex(index);
                      setPendingSelection(null);
                    }}
                    onChange={(patch) => updateBlock(index, patch)}
                    onInsertAfter={(type) => insertBlock(index, type)}
                    onRemove={() => removeBlock(index)}
                    onTypeChange={(type) => updateBlock(index, { type })}
                    onCharacterBlur={handleCharacterBlur}
                    onSluglineBlur={handleSluglineBlur}
                    characterOptions={characters.map((c) => c.name)}
                    locationOptions={locations.map((l) => l.name)}
                    editorRef={(node) => {
                      if (index === activeIndex) activeEditorRef.current = node;
                    }}
                  />
                  {pageBreakSet.has(index) ? (
                    <div className="screenplay-page-break" aria-hidden>
                      <span className="screenplay-page-break-label">
                        Стр.{" "}
                        {pageBreaks.find((b) => b.afterBlockIndex === index)!
                          .pageNumber + 1}
                      </span>
                    </div>
                  ) : null}
                </div>
              ))
            )}
              </div>

              {canWrite ? (
                <ScreenplayBlockCommentAnchor
                  blockId={anchorBlockId}
                  containerEl={paperColumnEl}
                  canWrite={canWrite}
                  hasOpenComments={
                    anchorBlockId
                      ? blocksWithOpenComments.has(anchorBlockId)
                      : false
                  }
                  composing={isComposing}
                  quote={pendingSelection?.quote}
                  onStartCompose={() => handleAddCommentClick(activeIndex)}
                  onDismiss={() => setPendingSelection(null)}
                  onCreate={(content) => {
                    if (!pendingSelection) return;
                    void createScriptCommentAction(projectId, versionId, {
                      ...pendingSelection,
                      content,
                    }).then(() => {
                      setPendingSelection(null);
                      void refreshComments();
                    });
                  }}
                />
              ) : null}

              <ScreenplayCommentsMargin
                threads={commentThreads}
                canWrite={canWrite}
                onReply={(parentId, content) => {
                  void replyScriptCommentAction(
                    projectId,
                    versionId,
                    parentId,
                    content,
                  ).then(() => void refreshComments());
                }}
                onResolve={(commentId, resolved) => {
                  void resolveScriptCommentAction(
                    projectId,
                    commentId,
                    resolved,
                  ).then(() => void refreshComments());
                }}
                onDelete={(commentId) => {
                  const replies = comments.filter(
                    (c) => c.parentCommentId === commentId,
                  ).length;
                  void confirmDelete({
                    title: "Удалить комментарий?",
                    details: replies > 0 ? [`Удалятся ответы: ${replies}`] : [],
                    action: async () => {
                      const result = await deleteScriptCommentAction(projectId, commentId);
                      if (result.error) return result.error;
                      void refreshComments();
                    },
                  });
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!sidebarExports) {
    return <div className="flex min-h-[70vh] flex-col gap-3">{editorContent}</div>;
  }

  return (
    <div className="screenplay-workspace-layout flex gap-4">
      <div className="min-w-0 flex-1">{editorContent}</div>
      <ScreenplayActionSidebar
        canWrite={canWrite}
        exporting={sidebarExports.exporting}
        pending={sidebarExports.pending || pending}
        timingLabel={timing.label}
        timingHint={timingHint}
        timingMode={timingMode}
        pageToMinuteRatio={pageToMinuteRatio}
        timingSaving={timingSaving}
        pageCount={timingMode === "PAGES" ? pageCount : undefined}
        isDirty={isDirty}
        search={search}
        onSearchChange={setSearch}
        onTimingModeChange={onTimingModeChange ?? (() => {})}
        onPageToMinuteRatioChange={onPageToMinuteRatioChange ?? (() => {})}
        onPageToMinuteRatioBlur={onPageToMinuteRatioBlur}
        onSave={handleSave}
        onLibretto={sidebarExports.onLibretto}
        onExportFountain={sidebarExports.onExportFountain}
        onExportDocx={sidebarExports.onExportDocx}
        onExportPdf={sidebarExports.onExportPdf}
      />
    </div>
  );
}
