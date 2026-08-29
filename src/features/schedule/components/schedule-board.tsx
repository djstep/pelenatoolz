"use client";

import { useActionState, useState } from "react";
import {
  assignSceneToDayAction,
  deleteShootDayAction,
  moveSceneInDayAction,
  removeSceneFromDayAction,
  type ActionState,
} from "@/features/schedule/actions";
import {
  computeDaySummary,
  formatDaySummary,
  formatPagesMinutes,
  formatSceneBrief,
} from "@/features/schedule/lib/day-summary";
import {
  dayNightLabels,
  intExtLabels,
  shootDayStatusLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

type SceneInDay = {
  id: string;
  sortOrder: number;
  estimatedPages: { toString(): string } | null;
  scene: {
    id: string;
    number: string;
    title: string | null;
    intExt: keyof typeof intExtLabels | null;
    dayNight: keyof typeof dayNightLabels | null;
    pageCount: { toString(): string } | null;
    estimatedDurationMin: number | null;
    locations: { location: { name: string } }[];
  };
};

type ShootDayRow = {
  id: string;
  dayNumber: number;
  date: Date;
  callTime: string | null;
  wrapTime: string | null;
  status: keyof typeof shootDayStatusLabels;
  notes: string | null;
  scenes: SceneInDay[];
};

type UnscheduledScene = SceneInDay["scene"];

const initial: ActionState = {};

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AssignSceneForm({
  projectId,
  shootDayId,
  unscheduled,
}: {
  projectId: string;
  shootDayId: string;
  unscheduled: UnscheduledScene[];
}) {
  const bound = assignSceneToDayAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);

  if (unscheduled.length === 0) {
    return (
      <p className="text-xs text-[var(--muted-fg)]">
        Все сцены уже распределены по дням.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 pt-3">
      <input type="hidden" name="shootDayId" value={shootDayId} />
      <Select name="sceneId" className="min-w-[16rem]" required defaultValue="">
        <option value="" disabled>
          Добавить сцену…
        </option>
        {unscheduled.map((s) => (
          <option key={s.id} value={s.id}>
            {formatSceneBrief(s)} ·{" "}
            {formatPagesMinutes(s.pageCount, s.estimatedDurationMin)}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" disabled={pending}>
        Добавить
      </Button>
      {state.error ? (
        <span className="text-xs text-[var(--danger)]">{state.error}</span>
      ) : null}
    </form>
  );
}

function SceneRowInDay({
  projectId,
  row,
  index,
  canWrite,
}: {
  projectId: string;
  row: SceneInDay;
  index: number;
  canWrite: boolean;
}) {
  const scene = row.scene;
  const location = scene.locations[0]?.location.name ?? "—";
  const intExtDay = [
    scene.intExt ? intExtLabels[scene.intExt] : null,
    scene.dayNight ? dayNightLabels[scene.dayNight] : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <tr className="border-b border-[var(--border)]/50 last:border-0">
      <td className="py-2 px-3 text-[var(--muted-fg)] w-8">{index + 1}</td>
      <td className="py-2 px-3 font-semibold whitespace-nowrap">{scene.number}</td>
      <td className="py-2 px-3">{location}</td>
      <td className="py-2 px-3 text-[var(--muted-fg)]">{intExtDay || "—"}</td>
      <td className="py-2 px-3 whitespace-nowrap">
        {formatPagesMinutes(
          row.estimatedPages ?? scene.pageCount,
          scene.estimatedDurationMin,
        )}
      </td>
      {canWrite ? (
        <td className="py-2 text-right whitespace-nowrap">
          <div className="inline-flex gap-0.5">
            <form
              action={async () => {
                await moveSceneInDayAction(projectId, row.id, "up");
              }}
            >
              <Button type="submit" variant="ghost" className="px-2">
                ↑
              </Button>
            </form>
            <form
              action={async () => {
                await moveSceneInDayAction(projectId, row.id, "down");
              }}
            >
              <Button type="submit" variant="ghost" className="px-2">
                ↓
              </Button>
            </form>
            <form
              action={async () => {
                await removeSceneFromDayAction(projectId, row.id);
              }}
            >
              <Button type="submit" variant="danger" className="px-2">
                ×
              </Button>
            </form>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function ShootDayAccordionRow({
  day,
  projectId,
  unscheduled,
  canWrite,
  expanded,
  onToggle,
}: {
  day: ShootDayRow;
  projectId: string;
  unscheduled: UnscheduledScene[];
  canWrite: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = computeDaySummary(day.scenes);

  return (
    <>
      <tr
        className={cn(
          "border-b border-[var(--border)] cursor-pointer transition hover:bg-white/5",
          expanded && "glass-row-expanded",
        )}
        onClick={onToggle}
      >
        <td className="py-3 pr-3 font-semibold whitespace-nowrap">
          <span className="mr-2 text-[var(--muted-fg)]">{expanded ? "▾" : "▸"}</span>
          День {day.dayNumber}
        </td>
        <td className="py-3 pr-3 whitespace-nowrap">{formatDate(day.date)}</td>
        <td className="py-3 pr-3">
          <Badge>{shootDayStatusLabels[day.status]}</Badge>
        </td>
        <td className="py-3 pr-3 text-sm text-[var(--muted-fg)]">
          {formatDaySummary(summary)}
        </td>
        <td className="py-3 pr-3 text-xs text-[var(--muted-fg)] hidden lg:table-cell">
          {day.callTime ? `сбор ${day.callTime}` : "—"}
          {day.wrapTime ? ` · ${day.wrapTime}` : ""}
        </td>
        {canWrite ? (
          <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
            <form
              action={async () => {
                await deleteShootDayAction(projectId, day.id);
              }}
            >
              <Button type="submit" variant="danger">
                Удалить
              </Button>
            </form>
          </td>
        ) : null}
      </tr>

      {expanded ? (
        <tr className="border-b border-[var(--border)] bg-white/4">
          <td colSpan={canWrite ? 6 : 5} className="px-4 pb-4 pt-2">
            {day.notes ? (
              <p className="mb-3 text-sm text-[var(--muted-fg)]">{day.notes}</p>
            ) : null}

            {day.scenes.length === 0 ? (
              <p className="text-sm text-[var(--muted-fg)]">Сцены не назначены</p>
            ) : (
              <div className="glass-panel overflow-x-auto">
                <table className="glass-table w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                      <th className="py-2 px-3 w-8">#</th>
                      <th className="py-2 px-3">Сцена</th>
                      <th className="py-2 px-3">Локация</th>
                      <th className="py-2 px-3">INT/EXT · Д/Н</th>
                      <th className="py-2 px-3">Стр. / мин</th>
                      {canWrite ? <th className="py-2 px-3" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {day.scenes.map((row, index) => (
                      <SceneRowInDay
                        key={row.id}
                        projectId={projectId}
                        row={row}
                        index={index}
                        canWrite={canWrite}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canWrite ? (
              <AssignSceneForm
                projectId={projectId}
                shootDayId={day.id}
                unscheduled={unscheduled}
              />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ScheduleBoard({
  projectId,
  shootDays,
  unscheduled,
  canWrite,
}: {
  projectId: string;
  shootDays: ShootDayRow[];
  unscheduled: UnscheduledScene[];
  canWrite: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(
    shootDays.length === 1 ? shootDays[0]?.id ?? null : null,
  );

  if (shootDays.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Съёмочных дней пока нет. Сначала добавьте сцены в разделе «Сценарий», затем
        создайте дни КПП.
      </p>
    );
  }

  return (
    <div className="glass-card overflow-x-auto">
      <table className="glass-table w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-3 px-3">День</th>
            <th className="py-3 px-3">Дата</th>
            <th className="py-3 px-3">Статус</th>
            <th className="py-3 px-3">Сводка</th>
            <th className="py-3 px-3 hidden lg:table-cell">Время</th>
            {canWrite ? <th className="py-3 px-3" /> : null}
          </tr>
        </thead>
        <tbody>
          {shootDays.map((day) => (
            <ShootDayAccordionRow
              key={day.id}
              day={day}
              projectId={projectId}
              unscheduled={unscheduled}
              canWrite={canWrite}
              expanded={expandedId === day.id}
              onToggle={() =>
                setExpandedId((current) => (current === day.id ? null : day.id))
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
