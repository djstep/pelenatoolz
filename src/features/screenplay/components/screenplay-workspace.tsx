"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { quickCreateLocationAction } from "@/features/locations/actions";
import { ScreenplayBlockEditor } from "@/features/screenplay/components/screenplay-block-editor";
import { ScreenplayLibrettoSyncPanel } from "@/features/screenplay/components/screenplay-libretto-sync-panel";
import { ScreenplaySaveModal } from "@/features/screenplay/components/screenplay-save-modal";
import { ScriptVersionTitleEditor } from "@/features/screenplay/components/script-version-title-editor";
import { ScriptVersionNoteEditor } from "@/features/screenplay/components/script-version-note-editor";
import type { ScriptCommentRow } from "@/features/screenplay/lib/comment-types";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import {
  exportScreenplayDocxAction,
  exportScreenplayFountainAction,
  exportScreenplayPrintHtmlAction,
  saveScreenplayVersionAction,
  updateProjectTimingAction,
} from "@/features/screenplay/actions";
import { quickCreateCharacterAction } from "@/features/script/actions";
import type { TimingMode } from "@prisma/client";
import { cn } from "@/shared/lib/cn";
import { useToast } from "@/shared/ui/toast";

import type { SceneTimingRef } from "@/features/screenplay/lib/timing";

type Option = { id: string; name: string };

type VersionInfo = {
  id: string;
  versionNumber: number;
  title: string | null;
  note: string | null;
  isCurrent: boolean;
  isLocked: boolean;
};

type Props = {
  projectId: string;
  locale: string;
  version: VersionInfo;
  blocks: ScreenplayBlock[];
  comments: ScriptCommentRow[];
  characters: Option[];
  locations: Option[];
  timingMode: TimingMode;
  pageToMinuteRatio: number;
  sceneTimings: SceneTimingRef[];
  canWrite: boolean;
};

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ScreenplayWorkspace({
  projectId,
  locale,
  version,
  blocks,
  comments,
  characters: initialCharacters,
  locations: initialLocations,
  timingMode,
  pageToMinuteRatio,
  sceneTimings,
  canWrite,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const base = `/${locale}/projects/${projectId}/screenplay`;
  const [exporting, setExporting] = useState<string | null>(null);
  const [characters, setCharacters] = useState(initialCharacters);
  const [locations, setLocations] = useState(initialLocations);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingBlocks, setPendingBlocks] = useState<ScreenplayBlock[] | null>(
    null,
  );
  const [librettoOpen, setLibrettoOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [timingModeState, setTimingModeState] = useState(timingMode);
  const [pageRatioState, setPageRatioState] = useState(pageToMinuteRatio);
  const [timingSaving, setTimingSaving] = useState(false);

  const persistTiming = useCallback(
    async (mode: TimingMode, ratio: number) => {
      setTimingSaving(true);
      try {
        const result = await updateProjectTimingAction(projectId, mode, ratio);
        if (result.error) {
          toast.error(result.error);
          return false;
        }
        setTimingModeState(mode);
        setPageRatioState(ratio);
        return true;
      } finally {
        setTimingSaving(false);
      }
    },
    [projectId, toast],
  );

  useEffect(() => {
    setTimingModeState(timingMode);
    setPageRatioState(pageToMinuteRatio);
  }, [timingMode, pageToMinuteRatio]);

  const handleTimingModeChange = useCallback(
    (mode: TimingMode) => {
      const previous = timingModeState;
      setTimingModeState(mode);
      void persistTiming(mode, pageRatioState).then((ok) => {
        if (!ok) setTimingModeState(previous);
      });
    },
    [pageRatioState, persistTiming, timingModeState],
  );

  const handlePageToMinuteRatioChange = useCallback(
    (ratio: number) => {
      setPageRatioState(ratio);
    },
    [],
  );

  const handlePageRatioBlur = useCallback(() => {
    void persistTiming(timingModeState, pageRatioState);
  }, [pageRatioState, persistTiming, timingModeState]);

  function navigateBack() {
    if (isDirty && !window.confirm("Есть несохранённые изменения. Уйти без сохранения?")) {
      return;
    }
    router.push(base);
  }

  const handleCreateCharacter = useCallback(
    async (name: string) => {
      const result = await quickCreateCharacterAction(projectId, name);
      if ("error" in result) return null;
      const option = { id: result.id, name: result.name };
      setCharacters((prev) =>
        prev.some((item) => item.id === option.id) ? prev : [...prev, option],
      );
      return option;
    },
    [projectId],
  );

  const handleCreateLocation = useCallback(
    async (name: string) => {
      const result = await quickCreateLocationAction(projectId, name);
      if ("error" in result) return null;
      const option = { id: result.id, name: result.name };
      setLocations((prev) =>
        prev.some((item) => item.id === option.id) ? prev : [...prev, option],
      );
      return option;
    },
    [projectId],
  );

  function persist(mode: "same" | "new", title?: string) {
    if (!pendingBlocks) return;
    startTransition(async () => {
      const result = await saveScreenplayVersionAction(
        projectId,
        version.id,
        mode,
        JSON.stringify({ blocks: pendingBlocks }),
        title,
      );
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setSaveOpen(false);
      setSaveError(null);
      setPendingBlocks(null);
      toast.success(result.success ?? "Сохранено");
      if (result.versionId && result.versionId !== version.id) {
        router.push(`${base}/${result.versionId}`);
      } else {
        router.refresh();
      }
    });
  }

  async function handleExportFountain() {
    setExporting("fountain");
    try {
      const result = await exportScreenplayFountainAction(projectId, version.id);
      if ("error" in result) return;
      downloadBlob(
        new Blob([result.content], { type: "text/plain;charset=utf-8" }),
        result.fileName,
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportDocx() {
    setExporting("docx");
    try {
      const result = await exportScreenplayDocxAction(projectId, version.id);
      if ("error" in result) return;
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      downloadBlob(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        result.fileName,
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPdf() {
    setExporting("pdf");
    try {
      const result = await exportScreenplayPrintHtmlAction(projectId, version.id);
      if ("error" in result) return;
      const printWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!printWindow) return;
      printWindow.document.write(result.html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } finally {
      setExporting(null);
    }
  }

  return (
    <div
      className={cn(
        "space-y-4",
        isFullscreen && "screenplay-workspace--fullscreen fixed inset-0 z-50 overflow-auto bg-[var(--background)] p-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={navigateBack}
            className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
          >
            ← Все версии
          </button>
          <div className="flex flex-wrap items-baseline gap-2">
            <ScriptVersionTitleEditor
              projectId={projectId}
              versionId={version.id}
              versionNumber={version.versionNumber}
              title={version.title}
              canWrite={canWrite}
              variant="heading"
            />
            {version.isCurrent ? (
              <span className="text-sm font-normal text-emerald-400">(текущая)</span>
            ) : null}
            {version.isLocked ? (
              <span className="text-sm font-normal text-amber-300">(заблокирована)</span>
            ) : null}
          </div>
          <div className="mt-2 max-w-2xl">
            <ScriptVersionNoteEditor
              projectId={projectId}
              versionId={version.id}
              note={version.note}
              canWrite={canWrite}
              variant="heading"
            />
          </div>
        </div>
      </div>

      <ScreenplayBlockEditor
        projectId={projectId}
        versionId={version.id}
        initialBlocks={blocks}
        initialComments={comments}
        characters={characters}
        locations={locations}
        timingMode={timingModeState}
        pageToMinuteRatio={pageRatioState}
        sceneTimings={sceneTimings}
        canWrite={canWrite}
        timingSaving={timingSaving}
        onTimingModeChange={handleTimingModeChange}
        onPageToMinuteRatioChange={handlePageToMinuteRatioChange}
        onPageToMinuteRatioBlur={handlePageRatioBlur}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((v) => !v)}
        onCreateCharacter={canWrite ? handleCreateCharacter : undefined}
        onCreateLocation={canWrite ? handleCreateLocation : undefined}
        onRequestSave={(nextBlocks) => {
          setPendingBlocks(nextBlocks);
          setSaveError(null);
          setSaveOpen(true);
        }}
        onDirtyChange={setIsDirty}
        sidebarExports={{
          exporting,
          pending,
          onLibretto: () => setLibrettoOpen(true),
          onExportFountain: () => void handleExportFountain(),
          onExportDocx: () => void handleExportDocx(),
          onExportPdf: () => void handleExportPdf(),
        }}
      />

      <ScreenplaySaveModal
        open={saveOpen}
        pending={pending}
        error={saveError}
        onClose={() => {
          setSaveOpen(false);
          setSaveError(null);
          setPendingBlocks(null);
        }}
        onSaveSame={() => persist("same")}
        onSaveNew={(title) => persist("new", title)}
      />

      <ScreenplayLibrettoSyncPanel
        open={librettoOpen}
        onClose={() => setLibrettoOpen(false)}
        onApplied={() => {
          setLibrettoOpen(false);
          toast.success("Либретто обновлено");
          router.refresh();
        }}
        projectId={projectId}
        versionId={version.id}
      />
    </div>
  );
}
