"use client";

import { useEffect, useRef, useTransition, useState, type FormEvent } from "react";
import type { CalendarConflict } from "@/features/prep-calendar/conflicts";
import { deletePrepEventAction, savePrepEventAction } from "@/features/prep-calendar/event-actions";
import {
  eventPlaceLabel,
  eventWhenLabel,
  EventTypeBadge,
} from "@/features/prep-calendar/components/event-chip";
import { ParticipantPicker } from "@/features/prep-calendar/components/participant-picker";
import type {
  CalendarEvent,
  CalendarOptions,
  CalendarParticipant,
  NewEventPreset,
} from "@/features/prep-calendar/lib/calendar-types";
import { addHour } from "@/features/prep-calendar/lib/event-form";
import { countOf } from "@/shared/lib/plural";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { DateInput } from "@/shared/ui/date-input";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";

const DEFAULT_START_TIME = "10:00";

type Target = { event: CalendarEvent } | { preset: NewEventPreset };

/** Начальные значения формы: из события или из места клика. */
function initialValues(target: Target, options: CalendarOptions) {
  if ("event" in target) {
    const { event } = target;
    return {
      title: event.title,
      typeId: event.type.id,
      allDay: event.allDay,
      startDate: event.startKey,
      endDate: event.endKey,
      startTime: event.startTime ?? DEFAULT_START_TIME,
      endTime: event.endTime ?? addHour(DEFAULT_START_TIME),
      locationId: event.locationId ?? "",
      locationText: event.locationText ?? "",
      note: event.note ?? "",
      participants: event.participants,
      departmentIds: event.departments.map((department) => department.id),
    };
  }
  const { preset } = target;
  const startTime = preset.time ?? DEFAULT_START_TIME;
  return {
    title: "",
    typeId: options.types.find((type) => !type.isHidden)?.id ?? "",
    allDay: preset.allDay,
    startDate: preset.dateKey,
    endDate: preset.dateKey,
    startTime,
    endTime: addHour(startTime),
    locationId: "",
    locationText: "",
    note: "",
    participants: [] as CalendarParticipant[],
    departmentIds: [] as string[],
  };
}

function EventForm({
  projectId,
  target,
  options,
  onClose,
}: {
  projectId: string;
  target: Target;
  options: CalendarOptions;
  onClose: () => void;
}) {
  const event = "event" in target ? target.event : null;
  const [values, setValues] = useState(() => initialValues(target, options));
  const [problem, setProblem] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<CalendarConflict[] | null>(null);
  const conflictsRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const confirmDelete = useConfirm();

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // Скрытый тип виден только у события, которому он уже назначен.
  const types = options.types.filter((type) => !type.isHidden || type.id === event?.type.id);
  const locationName = event?.locationName ?? null;

  // Предупреждение внизу длинной формы: показываем его, а не оставляем за краем окна.
  useEffect(() => {
    if (conflicts) conflictsRef.current?.scrollIntoView({ block: "nearest" });
  }, [conflicts]);

  function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    save(false);
  }

  function save(confirmOverlaps: boolean) {
    setProblem(null);
    setConflicts(null);
    const byKind = (kind: CalendarParticipant["kind"]) =>
      values.participants.filter((person) => person.kind === kind).map((person) => person.id);
    startTransition(async () => {
      const result = await savePrepEventAction(projectId, event?.id ?? null, {
        title: values.title,
        typeId: values.typeId,
        allDay: values.allDay,
        startDate: values.startDate,
        endDate: values.endDate,
        startTime: values.startTime,
        endTime: values.endTime,
        locationId: values.locationId,
        locationText: values.locationText,
        note: values.note,
        crewMemberIds: byKind("crew"),
        actorIds: byKind("actor"),
        castingPersonIds: byKind("candidate"),
        departmentIds: values.departmentIds,
        confirmOverlaps,
      });
      if (result.conflicts) {
        setConflicts(result.conflicts);
        return;
      }
      if (result.error) {
        setProblem(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Сохранено");
      onClose();
    });
  }

  return (
    <form id="prep-event-form" onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <div>
          <Label htmlFor="event-title">Название *</Label>
          <Input
            id="event-title"
            name="title"
            required
            maxLength={200}
            value={values.title}
            onChange={(change) => set("title", change.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="event-type">Тип *</Label>
          <Select
            id="event-type"
            name="typeId"
            value={values.typeId}
            onChange={(change) => set("typeId", change.target.value)}
          >
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Checkbox
        name="allDay"
        label="Весь день"
        checked={values.allDay}
        onChange={(change) => set("allDay", change.target.checked)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="event-start-date">Начало *</Label>
          <div className="flex gap-2">
            <DateInput
              id="event-start-date"
              name="startDate"
              className="min-w-0 flex-1"
              value={values.startDate}
              onChange={(change) => {
                const next = change.target.value;
                setValues((current) => ({
                  ...current,
                  startDate: next,
                  // Конец не должен оказаться раньше нового начала.
                  endDate: current.endDate < next ? next : current.endDate,
                }));
              }}
            />
            {!values.allDay ? (
              <div className="w-24 shrink-0">
                <HhMmInput
                  aria-label="Время начала"
                  name="startTime"
                  value={values.startTime}
                  onChange={(next) => {
                    setValues((current) => ({
                      ...current,
                      startTime: next,
                      // Правили начало в тот же день — конец сдвигается следом.
                      endTime:
                        next && current.endDate === current.startDate && current.endTime <= next
                          ? addHour(next)
                          : current.endTime,
                    }));
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <Label htmlFor="event-end-date">Окончание *</Label>
          <div className="flex gap-2">
            <DateInput
              id="event-end-date"
              name="endDate"
              className="min-w-0 flex-1"
              value={values.endDate}
              onChange={(change) => set("endDate", change.target.value)}
            />
            {!values.allDay ? (
              <div className="w-24 shrink-0">
                <HhMmInput
                  aria-label="Время окончания"
                  name="endTime"
                  value={values.endTime}
                  onChange={(next) => set("endTime", next)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="event-location">Объект из «Локаций»</Label>
          {options.locations ? (
            <Select
              id="event-location"
              name="locationId"
              value={values.locationId}
              onChange={(change) => set("locationId", change.target.value)}
            >
              <option value="">Не выбран</option>
              {options.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </Select>
          ) : (
            <p className="py-2 text-sm text-[var(--muted-fg)]">{locationName ?? "Не выбран"}</p>
          )}
        </div>
        <div>
          <Label htmlFor="event-location-text">Место текстом</Label>
          <Input
            id="event-location-text"
            name="locationText"
            maxLength={300}
            value={values.locationText}
            onChange={(change) => set("locationText", change.target.value)}
          />
        </div>
      </div>

      <ParticipantPicker
        sources={options}
        selected={values.participants}
        hiddenCandidates={event?.hiddenCandidates ?? 0}
        onChange={(next) => set("participants", next)}
      />

      {options.departments.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold">Цеха</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.departments.map((department) => (
              <Checkbox
                key={department.id}
                name="departmentId"
                value={department.id}
                label={department.name}
                checked={values.departmentIds.includes(department.id)}
                onChange={(change) =>
                  set(
                    "departmentIds",
                    change.target.checked
                      ? [...values.departmentIds, department.id]
                      : values.departmentIds.filter((id) => id !== department.id),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <div>
        <Label htmlFor="event-note">Заметка</Label>
        <textarea
          id="event-note"
          name="note"
          rows={3}
          maxLength={5000}
          value={values.note}
          onChange={(change) => set("note", change.target.value)}
          className="glass-input w-full rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {problem ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {problem}
        </p>
      ) : null}

      {conflicts ? (
        <div
          ref={conflictsRef}
          role="alert"
          className="space-y-2 rounded-lg border border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] p-3"
        >
          <p className="text-sm font-semibold text-[var(--tone-warning)]">
            Участники заняты в это время
          </p>
          <ul className="space-y-1 text-sm" data-testid="event-conflicts">
            {conflicts.map((conflict) => (
              <li key={conflict.key}>
                <span className="font-semibold">{conflict.title}</span>
                {conflict.source === "event" ? null : (
                  <span className="text-[var(--muted-fg)]"> · из кастинга</span>
                )}
                <span className="text-[var(--fg-2)]"> — {conflict.when}</span>
                {conflict.people.length > 0 ? (
                  <span className="block text-xs text-[var(--muted-fg)]">
                    {conflict.people.join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" disabled={pending} onClick={() => save(true)}>
              {pending ? "…" : "Сохранить всё равно"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConflicts(null)}>
              Вернуться
            </Button>
          </div>
        </div>
      ) : null}

      <div className={conflicts ? "hidden" : "flex flex-wrap items-center gap-3"}>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Сохранить"}
        </Button>
        <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
          Отмена
        </Button>
        {event ? (
          <Button
            type="button"
            variant="danger"
            className="sm:ml-auto"
            onClick={() =>
              void confirmDelete({
                title: `Удалить событие «${event.title}»?`,
                action: async () => {
                  const result = await deletePrepEventAction(projectId, event.id);
                  if (result.error) return result.error;
                  toast.success("Событие удалено");
                  onClose();
                },
              })
            }
          >
            Удалить
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Для тех, кто только смотрит: то же событие без полей ввода. */
function EventDetails({ event }: { event: CalendarEvent }) {
  const place = eventPlaceLabel(event);
  const people = event.participants.map((person) => person.label);
  if (event.hiddenCandidates > 0) {
    people.push(`+${countOf(event.hiddenCandidates, ["кандидат", "кандидата", "кандидатов"])}`);
  }
  const rows: [string, string | null][] = [
    ["Когда", eventWhenLabel(event)],
    ["Место", place],
    ["Участники", people.join(", ") || null],
    ["Цеха", event.departments.map((department) => department.name).join(", ") || null],
    ["Заметка", event.note],
  ];
  return (
    <div className="space-y-3">
      <EventTypeBadge type={event.type} />
      <dl className="space-y-2">
        {rows.map(([label, value]) =>
          value ? (
            <div key={label}>
              <dt className="text-xs font-semibold text-[var(--muted-fg)]">{label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  );
}

export function EventModal({
  projectId,
  target,
  options,
  onClose,
}: {
  projectId: string;
  target: Target;
  /** Нет права правки — null, окно только показывает событие. */
  options: CalendarOptions | null;
  onClose: () => void;
}) {
  const event = "event" in target ? target.event : null;
  if (!options) {
    return event ? (
      <Modal open onClose={onClose} title={event.title}>
        <EventDetails event={event} />
      </Modal>
    ) : null;
  }
  return (
    <Modal
      guardUnsaved
      wide
      open
      onClose={onClose}
      title={event ? `Событие: ${event.title}` : "Новое событие"}
    >
      <EventForm projectId={projectId} target={target} options={options} onClose={onClose} />
    </Modal>
  );
}
