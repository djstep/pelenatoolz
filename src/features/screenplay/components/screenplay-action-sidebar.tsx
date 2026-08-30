"use client";

import type { TimingMode } from "@prisma/client";
import { timingModeOptionLabels } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SegmentControl } from "@/shared/ui/segment-control";

type Props = {
  canWrite: boolean;
  exporting: string | null;
  pending: boolean;
  timingLabel: string;
  timingHint: string;
  timingMode: TimingMode;
  pageToMinuteRatio: number;
  timingSaving?: boolean;
  pageCount?: number;
  isDirty: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onTimingModeChange: (mode: TimingMode) => void;
  onPageToMinuteRatioChange: (ratio: number) => void;
  onPageToMinuteRatioBlur?: () => void;
  onSave: () => void;
  onLibretto: () => void;
  onExportFountain: () => void;
  onExportDocx: () => void;
  onExportPdf: () => void;
};

export function ScreenplayActionSidebar({
  canWrite,
  exporting,
  pending,
  timingLabel,
  timingHint,
  timingMode,
  pageToMinuteRatio,
  timingSaving = false,
  pageCount,
  isDirty,
  search,
  onSearchChange,
  onTimingModeChange,
  onPageToMinuteRatioChange,
  onPageToMinuteRatioBlur,
  onSave,
  onLibretto,
  onExportFountain,
  onExportDocx,
  onExportPdf,
}: Props) {
  return (
    <aside className="screenplay-action-sidebar">
      <div className="screenplay-action-sidebar-inner space-y-4">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Поиск по тексту…"
          className="text-xs"
        />

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs">
          <div className="text-[var(--muted-fg)]">Хронометраж</div>
          <div className="mt-1 text-lg font-medium tabular-nums">{timingLabel}</div>
          <div className="mt-0.5 text-[var(--muted-fg)]">{timingHint}</div>
          {pageCount != null && pageCount > 0 ? (
            <div className="mt-1 text-[var(--muted-fg)]">
              ~{pageCount} стр.
            </div>
          ) : null}
          {isDirty ? (
            <div className="mt-2 text-amber-400">Есть несохранённые изменения</div>
          ) : null}

          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-[var(--muted-fg)]">Метод расчёта</div>
            <SegmentControl
              name="timingMode"
              value={timingMode}
              onChange={onTimingModeChange}
              disabled={!canWrite || timingSaving}
              className="screenplay-timing-mode-control flex-col gap-1.5"
              options={(
                Object.keys(timingModeOptionLabels) as TimingMode[]
              ).map((mode) => ({
                value: mode,
                label: timingModeOptionLabels[mode],
              }))}
            />
            {timingMode === "PAGES" ? (
              <div className="mt-2">
                <label
                  htmlFor="screenplay-page-ratio"
                  className="mb-1 block text-[var(--muted-fg)]"
                >
                  1 страница = … мин
                </label>
                <Input
                  id="screenplay-page-ratio"
                  type="number"
                  step="0.01"
                  min={0.1}
                  max={10}
                  value={pageToMinuteRatio}
                  disabled={!canWrite || timingSaving}
                  className="text-xs"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) onPageToMinuteRatioChange(next);
                  }}
                  onBlur={() => onPageToMinuteRatioBlur?.()}
                />
              </div>
            ) : null}
            {timingSaving ? (
              <div className="mt-2 text-[var(--muted-fg)]">Сохранение…</div>
            ) : null}
          </div>
        </div>

        {canWrite ? (
          <Button
            type="button"
            className="w-full"
            disabled={pending}
            onClick={onSave}
          >
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        ) : null}

        {canWrite ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={onLibretto}
          >
            Обновить в либретто
          </Button>
        ) : null}

        <div className="space-y-2">
          <div className="text-xs font-medium text-[var(--muted-fg)]">Экспорт</div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={exporting !== null}
            onClick={onExportFountain}
          >
            Fountain
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={exporting !== null}
            onClick={onExportDocx}
          >
            DOCX
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={exporting !== null}
            onClick={onExportPdf}
          >
            PDF / печать
          </Button>
        </div>
      </div>
    </aside>
  );
}
