"use client";

import { TimeSlotType } from "@prisma/client";
import { useActionState, useState } from "react";
import {
  saveActorCallsAction,
  saveDepartmentCallsAction,
  saveResourceCallsAction,
  saveTimeSlotsAction,
  saveTransportsAction,
  updateCallSheetHeaderAction,
  type CallSheetActionState,
} from "@/features/day-docs/actions";
import type { CastRow, DayDocBundle, ResourceTableRow } from "@/features/day-docs/lib/build-day-doc";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

type DeptRow = {
  roleLabel: string;
  personName: string;
  phone: string;
  callTime: string;
};

type TransportRow = { name: string; callTime: string; notes: string };

type SlotRow = {
  startTime: string;
  endTime: string;
  slotType: TimeSlotType;
  sceneId: string;
  notes: string;
};

function ActionMessage({ state }: { state: CallSheetActionState }) {
  if (state.error) {
    return <p className="text-sm text-[var(--danger)]">{state.error}</p>;
  }
  if (state.success) {
    return <p className="text-sm text-green-400">{state.success}</p>;
  }
  return null;
}

function JsonRowsForm({
  action,
  rowsJson,
  label,
}: {
  action: (prev: CallSheetActionState, fd: FormData) => Promise<CallSheetActionState>;
  rowsJson: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="rows" value={rowsJson} />
      <ActionMessage state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Сохранение…" : label}
      </Button>
    </form>
  );
}

export function CallSheetEditor({
  projectId,
  dayId,
  bundle,
  cast,
  resources,
}: {
  projectId: string;
  dayId: string;
  bundle: DayDocBundle;
  cast: CastRow[];
  resources: {
    extras: ResourceTableRow[];
    stunts: ResourceTableRow[];
    art: ResourceTableRow[];
    camera: ResourceTableRow[];
    props: ResourceTableRow[];
    vehicles: ResourceTableRow[];
  };
}) {
  const { day } = bundle;
  const [open, setOpen] = useState(false);

  const [depts, setDepts] = useState<DeptRow[]>(
    day.departmentCalls.map((d) => ({
      roleLabel: d.roleLabel,
      personName: d.personName ?? "",
      phone: d.phone ?? "",
      callTime: d.callTime ?? "",
    })),
  );

  const [transports, setTransports] = useState<TransportRow[]>(
    day.transports.map((t) => ({
      name: t.name,
      callTime: t.callTime ?? "",
      notes: t.notes ?? "",
    })),
  );

  const [slots, setSlots] = useState<SlotRow[]>(
    day.timeSlots.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime ?? "",
      slotType: s.slotType,
      sceneId: s.sceneId ?? "",
      notes: s.notes ?? "",
    })),
  );

  const [actorTimings, setActorTimings] = useState(
    cast
      .filter((c) => c.actorId)
      .map((c) => ({
        actorId: c.actorId!,
        label: `${c.characterName} · ${c.actorName ?? "—"}`,
        pickupTime: c.pickup ?? "",
        arrivalTime: c.arrival ?? "",
        makeupTime: c.makeup ?? "",
        costumeTime: c.costume ?? "",
        readyTime: c.ready ?? "",
        wrapTime: c.wrap ?? "",
      })),
  );

  const allResources = [
    ...resources.extras,
    ...resources.stunts,
    ...resources.art,
    ...resources.camera,
    ...resources.props,
    ...resources.vehicles,
  ];

  const [resourceTimings, setResourceTimings] = useState(
    allResources.map((r) => ({
      category: r.category,
      name: r.name,
      label: r.name,
      arrivalTime: r.arrival ?? "",
      costumeTime: r.costume ?? "",
      makeupTime: r.makeup ?? "",
      readyTime: r.ready ?? "",
      wrapTime: r.wrap ?? "",
    })),
  );

  const headerAction = updateCallSheetHeaderAction.bind(null, projectId, dayId);
  const deptAction = saveDepartmentCallsAction.bind(null, projectId, dayId);
  const transportAction = saveTransportsAction.bind(null, projectId, dayId);
  const slotAction = saveTimeSlotsAction.bind(null, projectId, dayId);
  const actorAction = saveActorCallsAction.bind(null, projectId, dayId);
  const resourceAction = saveResourceCallsAction.bind(null, projectId, dayId);

  const [headerState, headerFormAction, headerPending] = useActionState(
    headerAction,
    {},
  );

  if (!open) {
    return (
      <div className="print:hidden">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Редактировать вызывной
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--panel-solid)] p-5 print:hidden">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Редактирование вызывного</h3>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Закрыть
        </Button>
      </div>

      <div className="space-y-8">
        <form action={headerFormAction} className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--muted-fg)]">Шапка дня</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">№ смены</span>
              <Input name="shiftNumber" type="number" min={1} defaultValue={day.shiftNumber ?? ""} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Сбор</span>
              <Input name="callTime" defaultValue={day.callTime ?? ""} placeholder="07:00" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Начало смены</span>
              <Input name="shiftStartTime" defaultValue={day.shiftStartTime ?? ""} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Репетиция</span>
              <Input name="rehearsalTime" defaultValue={day.rehearsalTime ?? ""} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Мотор</span>
              <Input name="motorOnTime" defaultValue={day.motorOnTime ?? ""} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Стоп-мотор</span>
              <Input name="motorOffTime" defaultValue={day.motorOffTime ?? ""} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Конец</span>
              <Input name="wrapTime" defaultValue={day.wrapTime ?? ""} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Сбор группы</span>
              <Input name="crewMeetTime" defaultValue={day.crewMeetTime ?? ""} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="text-[var(--muted-fg)]">Адрес сбора / выезд</span>
              <Input name="crewMeetAddress" defaultValue={day.crewMeetAddress ?? ""} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="text-[var(--muted-fg)]">Погода (ручная пометка)</span>
              <Input name="weatherNote" defaultValue={day.weatherNote ?? ""} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="text-[var(--muted-fg)]">Осадки</span>
              <Input name="weatherPrecip" defaultValue={day.weatherPrecip ?? ""} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="text-[var(--muted-fg)]">Примечания</span>
              <Input name="notes" defaultValue={day.notes ?? ""} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="text-[var(--muted-fg)]">Комментарий</span>
              <Input name="comment" defaultValue={day.comment ?? ""} />
            </label>
          </div>
          <ActionMessage state={headerState} />
          <Button type="submit" variant="secondary" disabled={headerPending}>
            {headerPending ? "Сохранение…" : "Сохранить шапку"}
          </Button>
        </form>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--muted-fg)]">Контакты по цехам</h4>
          {depts.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-5">
              <Input
                value={row.roleLabel}
                onChange={(e) =>
                  setDepts((p) =>
                    p.map((r, j) => (j === i ? { ...r, roleLabel: e.target.value } : r)),
                  )
                }
                placeholder="Цех / роль"
              />
              <Input
                value={row.personName}
                onChange={(e) =>
                  setDepts((p) =>
                    p.map((r, j) => (j === i ? { ...r, personName: e.target.value } : r)),
                  )
                }
                placeholder="ФИО"
              />
              <Input
                value={row.phone}
                onChange={(e) =>
                  setDepts((p) =>
                    p.map((r, j) => (j === i ? { ...r, phone: e.target.value } : r)),
                  )
                }
                placeholder="Телефон"
              />
              <Input
                value={row.callTime}
                onChange={(e) =>
                  setDepts((p) =>
                    p.map((r, j) => (j === i ? { ...r, callTime: e.target.value } : r)),
                  )
                }
                placeholder="Явка"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDepts((p) => p.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setDepts((p) => [...p, { roleLabel: "", personName: "", phone: "", callTime: "" }])
            }
          >
            + Строка
          </Button>
          <JsonRowsForm
            action={deptAction}
            rowsJson={JSON.stringify(depts.filter((r) => r.roleLabel.trim()))}
            label="Сохранить контакты"
          />
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--muted-fg)]">Спецтранспорт</h4>
          {transports.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-4">
              <Input
                value={row.name}
                onChange={(e) =>
                  setTransports((p) =>
                    p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                  )
                }
                placeholder="Техника"
              />
              <Input
                value={row.callTime}
                onChange={(e) =>
                  setTransports((p) =>
                    p.map((r, j) => (j === i ? { ...r, callTime: e.target.value } : r)),
                  )
                }
                placeholder="Прибытие"
              />
              <Input
                value={row.notes}
                onChange={(e) =>
                  setTransports((p) =>
                    p.map((r, j) => (j === i ? { ...r, notes: e.target.value } : r)),
                  )
                }
                placeholder="Примечание"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTransports((p) => p.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setTransports((p) => [...p, { name: "", callTime: "", notes: "" }])}
          >
            + Техника
          </Button>
          <JsonRowsForm
            action={transportAction}
            rowsJson={JSON.stringify(transports.filter((r) => r.name.trim()))}
            label="Сохранить спецтранспорт"
          />
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--muted-fg)]">Расписание по слотам</h4>
          {slots.map((row, i) => (
            <div key={i} className="grid gap-2 lg:grid-cols-6">
              <Input
                value={row.startTime}
                onChange={(e) =>
                  setSlots((p) =>
                    p.map((r, j) => (j === i ? { ...r, startTime: e.target.value } : r)),
                  )
                }
                placeholder="Начало"
              />
              <Input
                value={row.endTime}
                onChange={(e) =>
                  setSlots((p) =>
                    p.map((r, j) => (j === i ? { ...r, endTime: e.target.value } : r)),
                  )
                }
                placeholder="Конец"
              />
              <select
                className="glass-input rounded-lg px-3 py-2 text-sm"
                value={row.slotType}
                onChange={(e) =>
                  setSlots((p) =>
                    p.map((r, j) =>
                      j === i ? { ...r, slotType: e.target.value as TimeSlotType } : r,
                    ),
                  )
                }
              >
                {Object.entries(timeSlotTypeLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className="glass-input rounded-lg px-3 py-2 text-sm lg:col-span-2"
                value={row.sceneId}
                onChange={(e) =>
                  setSlots((p) =>
                    p.map((r, j) => (j === i ? { ...r, sceneId: e.target.value } : r)),
                  )
                }
              >
                <option value="">— сцена —</option>
                {day.scenes.map((s) => (
                  <option key={s.scene.id} value={s.scene.id}>
                    {s.scene.number}
                    {s.scene.postfix} · {s.scene.locations[0]?.location.name ?? ""}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSlots((p) => p.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setSlots((p) => [
                ...p,
                {
                  startTime: "",
                  endTime: "",
                  slotType: TimeSlotType.SHOOTING,
                  sceneId: "",
                  notes: "",
                },
              ])
            }
          >
            + Слот
          </Button>
          <JsonRowsForm
            action={slotAction}
            rowsJson={JSON.stringify(
              slots
                .filter((r) => r.startTime.trim())
                .map((r) => ({
                  ...r,
                  sceneId: r.sceneId || null,
                })),
            )}
            label="Сохранить расписание"
          />
        </div>

        {actorTimings.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--muted-fg)]">Тайминги актёров</h4>
            {actorTimings.map((row, i) => (
              <div key={row.actorId} className="rounded-xl border border-[var(--border)] p-3">
                <p className="mb-2 text-sm font-medium">{row.label}</p>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      ["pickupTime", "Подача"],
                      ["arrivalTime", "Прибытие"],
                      ["makeupTime", "Грим"],
                      ["costumeTime", "Костюм"],
                      ["readyTime", "Готовность"],
                      ["wrapTime", "Конец"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="space-y-1 text-xs">
                      <span className="text-[var(--muted-fg)]">{label}</span>
                      <Input
                        value={row[field]}
                        onChange={(e) =>
                          setActorTimings((p) =>
                            p.map((r, j) =>
                              j === i ? { ...r, [field]: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <JsonRowsForm
              action={actorAction}
              rowsJson={JSON.stringify(
                actorTimings.map(({ actorId, pickupTime, arrivalTime, makeupTime, costumeTime, readyTime, wrapTime }) => ({
                  actorId,
                  pickupTime,
                  arrivalTime,
                  makeupTime,
                  costumeTime,
                  readyTime,
                  wrapTime,
                })),
              )}
              label="Сохранить тайминги актёров"
            />
          </div>
        ) : null}

        {resourceTimings.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--muted-fg)]">
              Тайминги ресурсов (массовка, трюки, реквизит…)
            </h4>
            {resourceTimings.map((row, i) => (
              <div key={`${row.category}-${row.name}`} className="rounded-xl border border-[var(--border)] p-3">
                <p className="mb-2 text-sm font-medium">{row.label}</p>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {(
                    [
                      ["arrivalTime", "Прибытие"],
                      ["costumeTime", "Костюм"],
                      ["makeupTime", "Грим"],
                      ["readyTime", "Готовность"],
                      ["wrapTime", "Конец"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="space-y-1 text-xs">
                      <span className="text-[var(--muted-fg)]">{label}</span>
                      <Input
                        value={row[field]}
                        onChange={(e) =>
                          setResourceTimings((p) =>
                            p.map((r, j) =>
                              j === i ? { ...r, [field]: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <JsonRowsForm
              action={resourceAction}
              rowsJson={JSON.stringify(
                resourceTimings.map(
                  ({ category, name, arrivalTime, costumeTime, makeupTime, readyTime, wrapTime }) => ({
                    category,
                    name,
                    arrivalTime,
                    costumeTime,
                    makeupTime,
                    readyTime,
                    wrapTime,
                  }),
                ),
              )}
              label="Сохранить тайминги ресурсов"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
