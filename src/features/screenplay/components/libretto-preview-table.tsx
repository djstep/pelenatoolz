"use client";

import type { ReactNode } from "react";
import type { DayNight, IntExt } from "@prisma/client";
import type { ImportPreviewScene } from "@/features/import/types";
import {
  dayNightLabels,
  intExtLabels,
} from "@/shared/i18n/domain-labels";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

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
    <td className={cn("py-2 pr-2 align-top", changed && "bg-yellow-500/10")}>
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

export function LibrettoPreviewTable({ scenes }: { scenes: ImportPreviewScene[] }) {
  return (
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
  );
}
