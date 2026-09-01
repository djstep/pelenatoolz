"use client";

import { useMemo, useState, useTransition } from "react";
import type { ActorAvailabilityStatus } from "@prisma/client";
import {
  addActorToAvailabilityCalendarAction,
  removeAvailabilityRowAction,
  setAvailabilityDayAction,
} from "@/features/actor-availability/actions";
import {
  availabilityStatusLabels,
  cellColorClass,
  cellShortLabel,
  editorStatusOptionsList,
  getViewDays,
  parseDateKey,
  shiftViewAnchor,
  startOfWeekMonday,
  toDateKey,
  type AvailabilityViewMode,
} from "@/features/actor-availability/lib/status";
import { effectiveStatus } from "@/features/actor-availability/lib/planning-hint";
import type { AvailabilityRow, KppBusyMap } from "@/features/actor-availability/queries";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import {
  formatCalendarColumnHeader,
  formatDateRange,
  formatDateShort,
} from "@/shared/i18n/format-date";
import { useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

type ActorOpt = {
  id: string;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  character: { name: string } | null;
};

type ManualDays = Record<
  string,
  Record<string, { status: string; comment: string | null }>
>;

type DayEditorState = {
  rowId: string;
  rowLabel: string;
  dateKey: string;
  status: ActorAvailabilityStatus;
  comment: string;
  kppLocked: boolean;
};

function rowLabel(row: AvailabilityRow) {
  if (row.actor) {
    const name = fullNameFromParts(row.actor);
    const role = row.actor.character?.name;
    return role ? `${name} · ${role}` : name;
  }
  if (row.castingPerson) return fullNameFromParts(row.castingPerson);
  return "—";
}

function rowPhoto(row: AvailabilityRow) {
  return row.castingPerson?.photoUrl ?? null;
}

const VIEW_LABELS: Record<AvailabilityViewMode, string> = {
  week: "Неделя",
  "2weeks": "2 недели",
  month: "Месяц",
  custom: "Период",
};

export function AvailabilityCalendar({
  projectId,
  rows,
  actors,
  kppBusySerialized,
  manualDays,
  canWrite,
  initialPersonId,
  initialActorId,
}: {
  projectId: string;
  locale: string;
  rows: AvailabilityRow[];
  actors: ActorOpt[];
  kppBusySerialized: Record<string, string[]>;
  manualDays: ManualDays;
  canWrite: boolean;
  initialPersonId?: string;
  initialActorId?: string;
}) {
  const [viewMode, setViewMode] = useState<AvailabilityViewMode>("week");
  const [anchor, setAnchor] = useState(() => startOfWeekMonday(new Date()));
  const [customFrom, setCustomFrom] = useState(() => toDateKey(startOfWeekMonday(new Date())));
  const [customTo, setCustomTo] = useState(() => {
    const start = startOfWeekMonday(new Date());
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 13);
    return toDateKey(end);
  });
  const [search, setSearch] = useState("");
  const [addActorId, setAddActorId] = useState("");
  const [editor, setEditor] = useState<DayEditorState | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const kppBusy: KppBusyMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [key, ids] of Object.entries(kppBusySerialized)) {
      map.set(key, new Set(ids));
    }
    return map;
  }, [kppBusySerialized]);

  const days = useMemo(
    () => getViewDays(viewMode, anchor, customFrom, customTo),
    [viewMode, anchor, customFrom, customTo],
  );

  const periodLabel = useMemo(() => {
    if (days.length === 0) return "Период не выбран";
    return formatDateRange(days[0], days[days.length - 1], { utc: true });
  }, [days]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => rowLabel(r).toLowerCase().includes(q));
  }, [rows, search]);

  const inCalendarActorIds = new Set(
    rows.map((r) => r.actorId).filter(Boolean) as string[],
  );
  const addableActors = actors.filter((a) => !inCalendarActorIds.has(a.id));

  const highlightRowId =
    initialActorId || initialPersonId
      ? rows.find(
          (r) =>
            (initialActorId && r.actorId === initialActorId) ||
            (initialPersonId && r.castingPersonId === initialPersonId),
        )?.id
      : undefined;

  function openEditor(row: AvailabilityRow, dateKey: string) {
    const actorId = row.actorId;
    const kppLocked = actorId ? (kppBusy.get(dateKey)?.has(actorId) ?? false) : false;
    const status = effectiveStatus(row.id, actorId, dateKey, manualDays, kppBusy);
    const comment = manualDays[row.id]?.[dateKey]?.comment ?? "";
    setEditor({
      rowId: row.id,
      rowLabel: rowLabel(row),
      dateKey,
      status: kppLocked ? "BUSY_OUR_PROJECT" : status,
      comment,
      kppLocked,
    });
  }

  function saveEditor() {
    if (!editor) return;
    startTransition(async () => {
      const r = await setAvailabilityDayAction(
        projectId,
        editor.rowId,
        editor.dateKey,
        editor.status,
        editor.comment,
      );
      if (r.error) toast.error(r.error);
      if (r.success) {
        toast.success(r.success);
        setEditor(null);
      }
    });
  }

  function runAddActor() {
    if (!addActorId) return;
    startTransition(async () => {
      const r = await addActorToAvailabilityCalendarAction(projectId, addActorId);
      if (r.error) toast.error(r.error);
      if (r.success) {
        toast.success(r.success);
        setAddActorId("");
      }
    });
  }

  function runRemove(rowId: string) {
    if (!confirm("Убрать актёра из календаря занятости?")) return;
    startTransition(async () => {
      const r = await removeAvailabilityRowAction(projectId, rowId);
      if (r.error) toast.error(r.error);
      if (r.success) toast.success(r.success);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {viewMode !== "custom" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAnchor((a) => shiftViewAnchor(viewMode, a, -1))}
                >
                  ←
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAnchor(startOfWeekMonday(new Date()))}
                >
                  Сегодня
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAnchor((a) => shiftViewAnchor(viewMode, a, 1))}
                >
                  →
                </Button>
              </>
            ) : null}
            <div className="flex flex-wrap rounded-lg border border-[var(--border)] p-0.5 text-xs">
              {(Object.keys(VIEW_LABELS) as AvailabilityViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-md px-3 py-1 ${viewMode === mode ? "bg-[var(--accent)] text-white" : ""}`}
                  onClick={() => setViewMode(mode)}
                >
                  {VIEW_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-[var(--muted-fg)]">{periodLabel}</p>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск актёра…"
          className="max-w-xs"
        />
      </div>

      {viewMode === "custom" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="customFrom">С</Label>
            <Input
              id="customFrom"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="customTo">По</Label>
            <Input
              id="customTo"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1"
            />
          </div>
          <p className="text-xs text-[var(--muted-fg)]">Не более 120 дней за раз</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-[10px] text-[var(--muted-fg)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-emerald-500/30" /> Свободен
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-amber-500/35" /> Другой проект
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-violet-500/35" /> Наш проект (КПП или бронь)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-rose-500/35" /> Недоступен
        </span>
        <span>Клик по ячейке — выбор статуса и комментария</span>
      </div>

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={addActorId}
            onChange={(e) => setAddActorId(e.target.value)}
            className="min-w-[14rem]"
          >
            <option value="">Добавить актёра…</option>
            {addableActors.map((a) => (
              <option key={a.id} value={a.id}>
                {fullNameFromParts(a)}
                {a.character ? ` · ${a.character.name}` : ""}
              </option>
            ))}
          </Select>
          <Button type="button" onClick={runAddActor} disabled={!addActorId || pending}>
            Добавить
          </Button>
        </div>
      ) : null}

      {filteredRows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Календарь пуст. Добавьте актёра или перейдите из карточки в кастинге.
        </p>
      ) : days.length === 0 ? (
        <p className="text-sm text-[var(--danger)]">Укажите корректный период (дата «с» не позже «по»).</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[48rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--glass-table-head)]">
                <th className="sticky left-0 z-20 min-w-[10rem] bg-[var(--glass-table-head)] px-3 py-2 text-left">
                  Актёр
                </th>
                {days.map((d) => {
                  const header = formatCalendarColumnHeader(d, { utc: true });
                  return (
                    <th
                      key={toDateKey(d)}
                      className="min-w-[3.25rem] px-0.5 py-2 text-center font-normal text-[var(--muted-fg)]"
                    >
                      <div>{header.weekday}</div>
                      <div className="text-[10px] leading-tight text-[var(--foreground)]">
                        {header.dateLine}
                      </div>
                    </th>
                  );
                })}
                {canWrite ? <th className="w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-[var(--border)]/60 ${row.id === highlightRowId ? "bg-[var(--accent)]/10" : ""}`}
                >
                  <td className="sticky left-0 z-10 bg-[var(--panel-solid)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      {rowPhoto(row) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={rowPhoto(row)!}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--glass-badge-bg)] text-[10px]">
                          {rowLabel(row).slice(0, 1)}
                        </div>
                      )}
                      <span className="font-medium leading-tight">{rowLabel(row)}</span>
                    </div>
                  </td>
                  {days.map((d) => {
                    const dateKey = toDateKey(d);
                    const actorId = row.actorId;
                    const kppAuto = actorId
                      ? (kppBusy.get(dateKey)?.has(actorId) ?? false)
                      : false;
                    const status = effectiveStatus(
                      row.id,
                      actorId,
                      dateKey,
                      manualDays,
                      kppBusy,
                    );
                    const comment = manualDays[row.id]?.[dateKey]?.comment;
                    const short = cellShortLabel(status, { kppAuto });

                    return (
                      <td key={dateKey} className="px-0.5 py-1 text-center">
                        <button
                          type="button"
                          title={
                            comment
                              ? `${availabilityStatusLabels[status]} — ${comment}`
                              : availabilityStatusLabels[status]
                          }
                          disabled={!canWrite && !kppAuto}
                          className={`h-9 min-w-[3rem] rounded border px-0.5 text-[9px] font-medium leading-tight transition hover:brightness-110 disabled:cursor-default ${cellColorClass(status, { kppAuto })}`}
                          onClick={() => {
                            if (canWrite || kppAuto) openEditor(row, dateKey);
                          }}
                        >
                          {short}
                        </button>
                      </td>
                    );
                  })}
                  {canWrite ? (
                    <td className="px-2 py-1">
                      <Button
                        type="button"
                        variant="danger"
                        className="px-2 py-1 text-xs"
                        onClick={() => runRemove(row.id)}
                      >
                        ×
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="glass-card w-full max-w-md space-y-4 p-5">
            <div>
              <h3 className="font-semibold">Занятость</h3>
              <p className="mt-1 text-sm text-[var(--muted-fg)]">
                {editor.rowLabel} · {formatDateShort(parseDateKey(editor.dateKey), { utc: true })}
              </p>
            </div>

            {editor.kppLocked ? (
              <p className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-2 text-sm text-violet-100">
                Этот день занят по КПП — статус задаётся автоматически. Можно добавить
                комментарий.
              </p>
            ) : editor.status === "BUSY_OUR_PROJECT" ? (
              <p className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-2 text-sm text-violet-100">
                Ручная бронь на наш проект (без сцены в КПП). Подсказки при перетаскивании
                в КПП учитывают этот статус.
              </p>
            ) : null}

            <div>
              <Label htmlFor="dayStatus">Статус</Label>
              <Select
                id="dayStatus"
                value={editor.status}
                disabled={editor.kppLocked}
                onChange={(e) =>
                  setEditor((s) =>
                    s
                      ? { ...s, status: e.target.value as ActorAvailabilityStatus }
                      : s,
                  )
                }
                className="mt-1"
              >
                {editorStatusOptionsList.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="dayComment">Комментарий</Label>
              <textarea
                id="dayComment"
                className="glass-input mt-1 w-full resize-y px-3 py-2 text-sm"
                rows={3}
                value={editor.comment}
                onChange={(e) =>
                  setEditor((s) => (s ? { ...s, comment: e.target.value } : s))
                }
                placeholder="Например: занят до 15:00"
              />
            </div>

            <div className="flex gap-2">
              <Button type="button" onClick={saveEditor} disabled={pending}>
                {pending ? "…" : "Сохранить"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
