"use client";

import { useActionState, useState } from "react";
import type { DayNight, IntExt } from "@prisma/client";
import {
  applyScriptImportAction,
  previewScriptImportAction,
  type ImportActionState,
  type ImportPreviewScene,
} from "@/features/import/actions";
import {
  dayNightLabels,
  intExtLabels,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { FileDropzone } from "@/shared/ui/file-dropzone";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { SegmentControl } from "@/shared/ui/segment-control";
import { cn } from "@/shared/lib/cn";

const initial: ImportActionState = {};

function DiffCell({
  sceneKey,
  field,
  oldVal,
  newVal,
  defaultChecked,
}: {
  sceneKey: string;
  field: string;
  oldVal?: string | null;
  newVal?: string | null;
  defaultChecked?: boolean;
}) {
  const changed = (oldVal ?? "") !== (newVal ?? "");
  return (
    <td
      className={cn(
        "py-2 pr-2 align-top",
        changed && "bg-yellow-500/10",
      )}
    >
      {oldVal != null && oldVal !== "" ? (
        <>
          <div className="text-[10px] text-[var(--muted-fg)]">Старое</div>
          <div className="mb-1 text-[var(--muted-fg)]">{oldVal}</div>
        </>
      ) : null}
      <div className="text-[10px] text-[var(--muted-fg)]">Новое</div>
      <div className="mb-1">{newVal || "—"}</div>
      {changed || !oldVal ? (
        <label className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--muted-fg)]">
          <input
            type="checkbox"
            name={`upd_${sceneKey}_${field}`}
            defaultChecked={defaultChecked ?? true}
            className="accent-[var(--accent)]"
          />
          обновить
        </label>
      ) : null}
    </td>
  );
}

function PreviewTable({
  projectId,
  jobId,
  scenes,
}: {
  projectId: string;
  jobId: string;
  scenes: ImportPreviewScene[];
}) {
  const bound = applyScriptImportAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="jobId" value={jobId} />
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-white/[0.03] text-[var(--muted-fg)]">
              <th className="px-3 py-2.5">Сцена</th>
              <th className="px-3 py-2.5">Тип объекта</th>
              <th className="px-3 py-2.5">Объект</th>
              <th className="px-3 py-2.5">Персонажи</th>
              <th className="px-3 py-2.5">Хрон.</th>
              <th className="px-3 py-2.5">Сц. день</th>
              <th className="px-3 py-2.5">Режим</th>
              <th className="px-3 py-2.5">Сценарий</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border)]/50">
                <td className="px-3 py-2 align-top whitespace-nowrap">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      name={`sel_${row.key}`}
                      defaultChecked
                      className="accent-[var(--accent)]"
                    />
                    {row.episodeNumber > 0 ? `${row.episodeNumber}-` : ""}
                    {row.number}
                    {row.postfix}
                  </label>
                  {!row.existingId ? (
                    <span className="text-[10px] text-emerald-400">новая</span>
                  ) : (
                    <span className="text-[10px] text-amber-300">есть</span>
                  )}
                </td>
                <DiffCell
                  sceneKey={row.key}
                  field="intExt"
                  oldVal={
                    row.old?.intExt
                      ? intExtLabels[row.old.intExt as IntExt] ?? row.old.intExt
                      : undefined
                  }
                  newVal={
                    row.intExt
                      ? intExtLabels[row.intExt as IntExt] ?? row.intExt
                      : undefined
                  }
                  defaultChecked={!row.existingId}
                />
                <DiffCell
                  sceneKey={row.key}
                  field="location"
                  oldVal={row.old?.location}
                  newVal={row.location}
                  defaultChecked={!row.existingId}
                />
                <DiffCell
                  sceneKey={row.key}
                  field="characters"
                  oldVal={row.old?.characters.join(", ")}
                  newVal={row.characters.join(", ")}
                  defaultChecked={!row.existingId}
                />
                <DiffCell
                  sceneKey={row.key}
                  field="timing"
                  oldVal={row.old?.timing}
                  newVal={row.timing}
                  defaultChecked={!row.existingId}
                />
                <DiffCell
                  sceneKey={row.key}
                  field="scriptDay"
                  oldVal={
                    row.old?.scriptDay != null
                      ? String(row.old.scriptDay)
                      : undefined
                  }
                  newVal={
                    row.scriptDay != null ? String(row.scriptDay) : undefined
                  }
                  defaultChecked={!row.existingId}
                />
                <DiffCell
                  sceneKey={row.key}
                  field="dayNight"
                  oldVal={
                    row.old?.dayNight
                      ? dayNightLabels[row.old.dayNight as DayNight] ??
                        row.old.dayNight
                      : undefined
                  }
                  newVal={
                    row.dayNight
                      ? dayNightLabels[row.dayNight as DayNight] ?? row.dayNight
                      : undefined
                  }
                  defaultChecked={!row.existingId}
                />
                <DiffCell
                  sceneKey={row.key}
                  field="script"
                  oldVal={row.old?.script?.slice(0, 80)}
                  newVal={row.script?.slice(0, 80)}
                  defaultChecked={!row.existingId}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Импорт…" : "Импортировать"}
        </Button>
        {state.error ? (
          <span className="text-sm text-[var(--danger)]">{state.error}</span>
        ) : null}
        {state.success ? (
          <span className="text-sm text-emerald-400">{state.success}</span>
        ) : null}
      </div>
    </form>
  );
}

export function ScriptImportWizard({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const bound = previewScriptImportAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  const [timingMethod, setTimingMethod] = useState("pages");
  const [hasFile, setHasFile] = useState(false);
  const [showComparison, setShowComparison] = useState(true);

  if (!canWrite) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Импорт доступен пользователям с правом редактирования сцен.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <form action={action} className="glass-card space-y-6 p-6">
        <div>
          <h2 className="font-display text-xl font-semibold">Импорт сценария</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Word, КИТ Сценарист (.kitsp), Final Draft, Fountain, Celtx —
            распознаем шапки сцен, локации и персонажей.
          </p>
        </div>

        <section className="space-y-3">
          <div>
            <Label className="mb-1 block">Файл сценария</Label>
            <p className="mb-3 text-xs text-[var(--muted-fg)]">Шаг 1 из 3</p>
          </div>
          <FileDropzone
            name="file"
            required
            disabled={pending}
            onFileChange={(file) => setHasFile(Boolean(file))}
          />
        </section>

        <section className="space-y-3">
          <div>
            <Label className="mb-1 block">Расчёт хронометража</Label>
            <p className="mb-3 text-xs text-[var(--muted-fg)]">Шаг 2 из 3</p>
          </div>
          <SegmentControl
            name="timingMethod"
            value={timingMethod}
            onChange={setTimingMethod}
            disabled={pending}
            options={[
              { value: "pages", label: "По страницам" },
              { value: "words", label: "По словам" },
              { value: "file", label: "Из файла" },
              { value: "none", label: "Не считать" },
            ]}
          />
          {timingMethod === "pages" ? (
            <div className="max-w-[12rem]">
              <Label htmlFor="pageRatio">Коэффициент мин/стр.</Label>
              <Input
                id="pageRatio"
                name="pageRatio"
                type="number"
                min={0.1}
                step="0.01"
                placeholder="1"
              />
            </div>
          ) : null}
          {timingMethod === "words" ? (
            <p className="text-xs text-[var(--muted-fg)]">
              Оценка: ≈2 слова = 1 секунда экранного времени.
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <div>
            <Label className="mb-1 block">Сравнение</Label>
            <p className="mb-3 text-xs text-[var(--muted-fg)]">Шаг 3 из 3</p>
          </div>
          {showComparison ? (
            <input type="hidden" name="showComparison" value="on" />
          ) : null}
          <Checkbox
            checked={showComparison}
            disabled={pending}
            onChange={(e) => setShowComparison(e.target.checked)}
            label="Показывать сравнение с уже существующими сценами"
          />
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">
          <Button type="submit" disabled={pending || !hasFile}>
            {pending ? "Анализ…" : "Предпросмотр"}
          </Button>
          {!hasFile ? (
            <span className="text-xs text-[var(--muted-fg)]">
              Сначала выберите файл
            </span>
          ) : null}
        </div>

        {state.error ? (
          <p
            className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
            role="alert"
          >
            {state.error}
          </p>
        ) : null}
      </form>

      {state.preview ? (
        <div className="glass-card space-y-3 p-6">
          <div>
            <h3 className="font-display text-lg font-semibold">Предпросмотр</h3>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {state.preview.fileName} · {state.preview.scenes.length} сцен
            </p>
          </div>
          <PreviewTable
            projectId={projectId}
            jobId={state.preview.jobId}
            scenes={state.preview.scenes}
          />
        </div>
      ) : null}
    </div>
  );
}
