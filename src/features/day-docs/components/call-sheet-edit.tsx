"use client";

import { TimeSlotType } from "@prisma/client";
import { useActionState, useState } from "react";
import {
  saveActorCallsAction,
  saveDepartmentCallsAction,
  saveResourceCallsAction,
  saveResourceUsagesAction,
  saveTimeSlotsAction,
  saveTransportsAction,
  updateCallSheetHeaderAction,
  type CallSheetActionState,
} from "@/features/day-docs/actions";
import type { CastRow, DayDocBundle, PerShiftResourceRow, ResourceTableRow } from "@/features/day-docs/lib/build-day-doc";
import {
  isManualActorTiming,
  type ActorTimingBaselines,
  type ActorTimingField,
} from "@/features/day-docs/lib/compute-call-timings";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { useActionToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

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
  useActionToast(state);
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
  perShiftResources,
  timingBaselines = {},
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
  perShiftResources: PerShiftResourceRow[];
  timingBaselines?: ActorTimingBaselines;
}) {
  const { day } = bundle;
  const [open, setOpen] = useState(false);
  const [headerTimes, setHeaderTimes] = useState({
    callTime: day.callTime ?? "",
    shiftStartTime: day.shiftStartTime ?? "",
    rehearsalTime: day.rehearsalTime ?? "",
    motorOnTime: day.motorOnTime ?? "",
    motorOffTime: day.motorOffTime ?? "",
    wrapTime: day.wrapTime ?? "",
    crewMeetTime: day.crewMeetTime ?? "",
  });

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

  const [perShiftRows, setPerShiftRows] = useState(
    perShiftResources.map((r) => ({
      itemId: r.itemId,
      label: `${r.categoryName} · ${r.itemName}`,
      isUsed: r.isUsed,
      arrivalTime: r.arrival ?? "",
      defaultArrival: r.defaultArrival ?? "",
    })),
  );

  const headerAction = updateCallSheetHeaderAction.bind(null, projectId, dayId);
  const deptAction = saveDepartmentCallsAction.bind(null, projectId, dayId);
  const transportAction = saveTransportsAction.bind(null, projectId, dayId);
  const slotAction = saveTimeSlotsAction.bind(null, projectId, dayId);
  const actorAction = saveActorCallsAction.bind(null, projectId, dayId);
  const resourceAction = saveResourceCallsAction.bind(null, projectId, dayId);
  const perShiftAction = saveResourceUsagesAction.bind(null, projectId, dayId);

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
              <HhMmInput
                value={headerTimes.callTime}
                onChange={(callTime) =>
                  setHeaderTimes((p) => ({ ...p, callTime }))
                }
                placeholder="07:00"
              />
              <input type="hidden" name="callTime" value={headerTimes.callTime} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Начало смены</span>
              <HhMmInput
                value={headerTimes.shiftStartTime}
                onChange={(shiftStartTime) =>
                  setHeaderTimes((p) => ({ ...p, shiftStartTime }))
                }
                placeholder="08:00"
              />
              <input type="hidden" name="shiftStartTime" value={headerTimes.shiftStartTime} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Репетиция</span>
              <HhMmInput
                value={headerTimes.rehearsalTime}
                onChange={(rehearsalTime) =>
                  setHeaderTimes((p) => ({ ...p, rehearsalTime }))
                }
              />
              <input type="hidden" name="rehearsalTime" value={headerTimes.rehearsalTime} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Мотор</span>
              <HhMmInput
                value={headerTimes.motorOnTime}
                onChange={(motorOnTime) =>
                  setHeaderTimes((p) => ({ ...p, motorOnTime }))
                }
              />
              <input type="hidden" name="motorOnTime" value={headerTimes.motorOnTime} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Стоп-мотор</span>
              <HhMmInput
                value={headerTimes.motorOffTime}
                onChange={(motorOffTime) =>
                  setHeaderTimes((p) => ({ ...p, motorOffTime }))
                }
              />
              <input type="hidden" name="motorOffTime" value={headerTimes.motorOffTime} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Конец</span>
              <HhMmInput
                value={headerTimes.wrapTime}
                onChange={(wrapTime) =>
                  setHeaderTimes((p) => ({ ...p, wrapTime }))
                }
              />
              <input type="hidden" name="wrapTime" value={headerTimes.wrapTime} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Сбор группы</span>
              <HhMmInput
                value={headerTimes.crewMeetTime}
                onChange={(crewMeetTime) =>
                  setHeaderTimes((p) => ({ ...p, crewMeetTime }))
                }
              />
              <input type="hidden" name="crewMeetTime" value={headerTimes.crewMeetTime} />
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
              <HhMmInput
                value={row.callTime}
                onChange={(callTime) =>
                  setDepts((p) =>
                    p.map((r, j) => (j === i ? { ...r, callTime } : r)),
                  )
                }
                placeholder="07:00"
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
              <HhMmInput
                value={row.callTime}
                onChange={(callTime) =>
                  setTransports((p) =>
                    p.map((r, j) => (j === i ? { ...r, callTime } : r)),
                  )
                }
                placeholder="07:00"
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
              <HhMmInput
                value={row.startTime}
                onChange={(startTime) =>
                  setSlots((p) =>
                    p.map((r, j) => (j === i ? { ...r, startTime } : r)),
                  )
                }
                placeholder="08:00"
              />
              <HhMmInput
                value={row.endTime}
                onChange={(endTime) =>
                  setSlots((p) =>
                    p.map((r, j) => (j === i ? { ...r, endTime } : r)),
                  )
                }
                placeholder="09:00"
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
            {actorTimings.map((row, i) => {
              const baseline = timingBaselines[row.actorId];
              return (
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
                  ).map(([field, label]) => {
                    const computed =
                      field !== "arrivalTime"
                        ? baseline?.[field as ActorTimingField]
                        : undefined;
                    const manual = isManualActorTiming(row[field], computed);
                    return (
                    <label key={field} className="space-y-1 text-xs">
                      <span className="text-[var(--muted-fg)]">
                        {label}
                        {manual && computed ? (
                          <span className="ml-1 text-amber-300/90" title={`Расчётное: ${computed}`}>
                            · ручн.
                          </span>
                        ) : null}
                      </span>
                      <HhMmInput
                        value={row[field]}
                        onChange={(v) =>
                          setActorTimings((p) =>
                            p.map((r, j) =>
                              j === i ? { ...r, [field]: v } : r,
                            ),
                          )
                        }
                        placeholder="00:00"
                        className={cn(
                          manual && "border-amber-400/50 bg-amber-500/10",
                        )}
                        title={manual && computed ? `Расчётное: ${computed}` : undefined}
                      />
                    </label>
                    );
                  })}
                </div>
              </div>
              );
            })}
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
                      <HhMmInput
                        value={row[field]}
                        onChange={(v) =>
                          setResourceTimings((p) =>
                            p.map((r, j) =>
                              j === i ? { ...r, [field]: v } : r,
                            ),
                          )
                        }
                        placeholder="00:00"
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

        {perShiftRows.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--muted-fg)]">
              Посменные ресурсы
            </h4>
            {perShiftRows.map((row, i) => (
              <div
                key={row.itemId}
                className="grid gap-2 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-[1fr_auto_8rem]"
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.isUsed}
                    onChange={(e) =>
                      setPerShiftRows((p) =>
                        p.map((r, j) =>
                          j === i ? { ...r, isUsed: e.target.checked } : r,
                        ),
                      )
                    }
                  />
                  <span>{row.label}</span>
                </label>
                <span className="self-center text-xs text-[var(--muted-fg)]">
                  {row.defaultArrival ? `по умолч. ${row.defaultArrival}` : ""}
                </span>
                <label className="space-y-1 text-xs">
                  <span className="text-[var(--muted-fg)]">Прибытие</span>
                  <HhMmInput
                    value={row.arrivalTime}
                    placeholder={row.defaultArrival || "08:00"}
                    onChange={(arrivalTime) =>
                      setPerShiftRows((p) =>
                        p.map((r, j) =>
                          j === i ? { ...r, arrivalTime } : r,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <JsonRowsForm
              action={perShiftAction}
              rowsJson={JSON.stringify(
                perShiftRows.map(({ itemId, isUsed, arrivalTime }) => ({
                  itemId,
                  isUsed,
                  arrivalTime,
                })),
              )}
              label="Сохранить посменные ресурсы"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
