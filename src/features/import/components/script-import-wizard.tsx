"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DayNight, IntExt } from "@prisma/client";
import {
  applyScriptImportAction,
  previewScriptImportAction,
} from "@/features/import/actions";
import type { ImportActionState, ImportPreviewScene } from "@/features/import/types";
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

function EditableDiffCell({
  sceneKey,
  field,
  oldVal,
  newVal,
  defaultChecked,
  children,
}: {
  sceneKey: string;
  field: string;
  oldVal?: string | null;
  newVal?: string | null;
  defaultChecked?: boolean;
  children: ReactNode;
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
      <div className="mb-1">{children}</div>
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
  locale,
  jobId,
  scenes,
}: {
  projectId: string;
  locale: string;
  jobId: string;
  scenes: ImportPreviewScene[];
}) {
  const router = useRouter();
  const bound = applyScriptImportAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);

  useEffect(() => {
    if (state.versionId) {
      router.push(
        `/${locale}/projects/${projectId}/screenplay/${state.versionId}`,
      );
    }
  }, [state.versionId, locale, projectId, router]);

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
                  <label className="mb-1 flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      name={`sel_${row.key}`}
                      defaultChecked
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-[10px] text-[var(--muted-fg)]">№</span>
                  </label>
                  <div className="flex items-center gap-1">
                    {row.episodeNumber > 0 ? (
                      <Input
                        name={`scene_${row.key}_episodeNumber`}
                        defaultValue={String(row.episodeNumber)}
                        className="h-8 w-12 px-2 text-xs"
                      />
                    ) : (
                      <input
                        type="hidden"
                        name={`scene_${row.key}_episodeNumber`}
                        value="0"
                      />
                    )}
                    <Input
                      name={`scene_${row.key}_number`}
                      defaultValue={row.number}
                      className="h-8 w-14 px-2 text-xs"
                    />
                    <Input
                      name={`scene_${row.key}_postfix`}
                      defaultValue={row.postfix}
                      placeholder="A"
                      className="h-8 w-10 px-2 text-xs"
                    />
                  </div>
                  {!row.existingId ? (
                    <span className="text-[10px] text-emerald-400">новая</span>
                  ) : (
                    <span className="text-[10px] text-amber-300">есть</span>
                  )}
                </td>
                <EditableDiffCell
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
                >
                  <select
                    name={`scene_${row.key}_intExt`}
                    defaultValue={row.intExt ?? ""}
                    className="glass-input h-8 w-full rounded-lg px-2 text-xs"
                  >
                    <option value="">—</option>
                    {Object.entries(intExtLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </EditableDiffCell>
                <EditableDiffCell
                  sceneKey={row.key}
                  field="location"
                  oldVal={row.old?.location}
                  newVal={row.location}
                  defaultChecked={!row.existingId}
                >
                  <Input
                    name={`scene_${row.key}_location`}
                    defaultValue={row.location ?? ""}
                    className="h-8 px-2 text-xs"
                  />
                </EditableDiffCell>
                <EditableDiffCell
                  sceneKey={row.key}
                  field="characters"
                  oldVal={row.old?.characters.join(", ")}
                  newVal={row.characters.join(", ")}
                  defaultChecked={!row.existingId}
                >
                  <Input
                    name={`scene_${row.key}_characters`}
                    defaultValue={row.characters.join(", ")}
                    className="h-8 px-2 text-xs"
                  />
                </EditableDiffCell>
                <EditableDiffCell
                  sceneKey={row.key}
                  field="timing"
                  oldVal={row.old?.timing}
                  newVal={row.timing}
                  defaultChecked={!row.existingId}
                >
                  <Input
                    name={`scene_${row.key}_timing`}
                    defaultValue={row.timing ?? ""}
                    placeholder="00:00"
                    className="h-8 w-20 px-2 text-xs"
                  />
                </EditableDiffCell>
                <EditableDiffCell
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
                >
                  <Input
                    name={`scene_${row.key}_scriptDay`}
                    type="number"
                    min={0}
                    defaultValue={row.scriptDay ?? ""}
                    className="h-8 w-16 px-2 text-xs"
                  />
                </EditableDiffCell>
                <EditableDiffCell
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
                >
                  <select
                    name={`scene_${row.key}_dayNight`}
                    defaultValue={row.dayNight ?? ""}
                    className="glass-input h-8 w-full rounded-lg px-2 text-xs"
                  >
                    <option value="">—</option>
                    {Object.entries(dayNightLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </EditableDiffCell>
                <EditableDiffCell
                  sceneKey={row.key}
                  field="script"
                  oldVal={row.old?.script?.slice(0, 80)}
                  newVal={row.script?.slice(0, 80)}
                  defaultChecked={!row.existingId}
                >
                  <textarea
                    name={`scene_${row.key}_script`}
                    defaultValue={row.script ?? ""}
                    rows={3}
                    className="glass-input w-full min-w-[12rem] resize-y rounded-lg px-2 py-1.5 text-xs"
                  />
                </EditableDiffCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 p-4">
        <Label htmlFor="version-title" className="mb-2 block text-sm font-medium">
          Название версии
        </Label>
        <Input
          id="version-title"
          name="versionTitle"
          required
          placeholder="Например: Импорт от 30.08, Черновик режиссёра"
          className="max-w-md"
          disabled={pending}
        />
        <p className="mt-2 text-xs text-[var(--muted-fg)]">
          Обязательное поле — так версия появится в списке сценария.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Создание версии…" : "Создать версию"}
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
  locale,
  canWrite,
}: {
  projectId: string;
  locale: string;
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
          <p className="text-sm text-[var(--muted-fg)]">
            Проверьте распознанные сцены. Импорт создаст новую версию текста;
            либретто обновляется отдельно.
          </p>
          <PreviewTable
            projectId={projectId}
            locale={locale}
            jobId={state.preview.jobId}
            scenes={state.preview.scenes}
          />
        </div>
      ) : null}
    </div>
  );
}
