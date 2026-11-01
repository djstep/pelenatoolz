"use client";

import { useActionState, useRef, useState } from "react";
import {
  saveCallSheetSheetAction,
  type CallSheetTemplateActionState,
} from "@/features/call-sheets/actions";
import {
  RemoveButton,
  Section,
  SortableRows,
  stripKey,
  withKeys,
} from "@/features/call-sheets/components/call-sheet-template-editor";
import type { CallSheetBlocks, TemplateMemberOption } from "@/features/call-sheets/queries";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

type Leader = {
  key: string;
  id: string;
  position: string;
  shortTitle: string;
  membershipId: string;
  personName: string;
  phone: string;
  /** Снимок ФИ и телефона участника в этой строке (до правки). */
  storedMembershipId: string;
};
type CrewCall = { key: string; departmentId: string; label: string; callTime: string };
type BaseItem = { key: string; name: string; callTime: string; notNeeded: boolean };

const initial: CallSheetTemplateActionState = {};
const FREE_PERSON = "";
const OWN_ROW = "";

const textareaClass =
  "glass-input min-h-20 w-full rounded-xl px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]";

export type SchemeLocationOption = { id: string; label: string };

/**
 * Правка вызывного дня: поля листа (температура, «Важно», «Ограничения по актёрам», объект
 * схемы) и его копии блоков шаблона — руководители, вызов цехов, база и транспорт.
 */
export function CallSheetSheetEditor({
  projectId,
  dayId,
  callSheet,
  members,
  departments,
  locations,
  onSaved,
}: {
  projectId: string;
  dayId: string;
  callSheet: CallSheetBlocks;
  members: TemplateMemberOption[];
  departments: { id: string; name: string }[];
  /** Объекты сцен дня — для «Объекта схемы». */
  locations: SchemeLocationOption[];
  onSaved: () => void;
}) {
  const bound = saveCallSheetSheetAction.bind(null, projectId, dayId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(true, undefined, state);
  useActionSuccess(state, () => {
    markClean();
    onSaved();
  });

  const nextKey = useRef(0);
  const newKey = () => `n${nextKey.current++}`;

  const [fields, setFields] = useState({
    tempDay: callSheet.tempDay ?? "",
    tempNight: callSheet.tempNight ?? "",
    importantNote: callSheet.importantNote ?? "",
    actorRestrictions: callSheet.actorRestrictions ?? "",
    schemeLocationId: callSheet.schemeLocationId ?? "",
  });
  const [leaders, setLeaders] = useState<Leader[]>(() =>
    withKeys(
      callSheet.leaders.map((row) => ({
        id: row.id,
        position: row.position,
        shortTitle: row.shortTitle ?? "",
        membershipId: row.membershipId ?? "",
        personName: row.personName ?? "",
        phone: row.phone ?? "",
        storedMembershipId: row.membershipId ?? "",
      })),
      "l",
    ),
  );
  const [crewCalls, setCrewCalls] = useState<CrewCall[]>(() =>
    withKeys(
      callSheet.crewCalls.map((row) => ({
        departmentId: row.departmentId ?? "",
        label: row.label,
        callTime: row.callTime ?? "",
      })),
      "c",
    ),
  );
  const [baseItems, setBaseItems] = useState<BaseItem[]>(() =>
    withKeys(
      callSheet.baseItems.map((row) => ({
        name: row.name,
        callTime: row.callTime ?? "",
        notNeeded: row.notNeeded,
      })),
      "b",
    ),
  );

  const memberById = new Map(members.map((m) => [m.membershipId, m]));
  const departmentById = new Map(departments.map((d) => [d.id, d.name]));
  const schemeOptions =
    callSheet.schemeLocation && !locations.some((l) => l.id === callSheet.schemeLocationId)
      ? [
          ...locations,
          {
            id: callSheet.schemeLocation.id,
            label: [callSheet.schemeLocation.name, callSheet.schemeLocation.sublocation]
              .filter(Boolean)
              .join(". "),
          },
        ]
      : locations;

  const payload = JSON.stringify({
    ...fields,
    leaders: stripKey(leaders).map((row) => {
      const rest: Partial<typeof row> = { ...row };
      delete rest.storedMembershipId;
      return rest;
    }),
    crewCalls: stripKey(crewCalls),
    baseItems: stripKey(baseItems),
  });

  function patch<T extends { key: string }>(
    setter: (fn: (rows: T[]) => T[]) => void,
    key: string,
    change: Partial<T>,
  ) {
    setter((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  return (
    <form ref={ref} onSubmit={submitKeepingFields(action)} className="space-y-8">
      <input type="hidden" name="payload" value={payload} />

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Поля листа</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs">
            <span className="text-[var(--muted-fg)]">t днём</span>
            <Input
              maxLength={20}
              placeholder="+18"
              value={fields.tempDay}
              onChange={(e) => setFields((f) => ({ ...f, tempDay: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-[var(--muted-fg)]">t ночью</span>
            <Input
              maxLength={20}
              placeholder="+12"
              value={fields.tempNight}
              onChange={(e) => setFields((f) => ({ ...f, tempNight: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="text-[var(--muted-fg)]">Объект схемы</span>
            <Select
              value={fields.schemeLocationId}
              onChange={(e) => setFields((f) => ({ ...f, schemeLocationId: e.target.value }))}
            >
              <option value="">— не выбран —</option>
              {schemeOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="text-[var(--muted-fg)]">Важно</span>
            <textarea
              className={textareaClass}
              maxLength={2000}
              value={fields.importantNote}
              onChange={(e) => setFields((f) => ({ ...f, importantNote: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="text-[var(--muted-fg)]">Ограничения по актёрам</span>
            <textarea
              className={textareaClass}
              maxLength={2000}
              value={fields.actorRestrictions}
              onChange={(e) => setFields((f) => ({ ...f, actorRestrictions: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <Section
        title="Руководители группы"
        hint="Участник проекта — ФИ и телефон берутся из его профиля в момент выбора; иначе впишите имя и телефон."
        addLabel="+ Руководитель"
        empty={leaders.length === 0}
        onAdd={() =>
          setLeaders((rows) => [
            ...rows,
            {
              key: newKey(),
              id: "",
              position: "",
              shortTitle: "",
              membershipId: "",
              personName: "",
              phone: "",
              storedMembershipId: "",
            },
          ])
        }
      >
        <SortableRows
          rows={leaders}
          onReorder={setLeaders}
          renderRow={(row, index) => {
            const member = row.membershipId ? memberById.get(row.membershipId) : undefined;
            const sameAsStored = row.id !== "" && row.membershipId === row.storedMembershipId;
            return (
              <>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_8rem_1.2fr]">
                  <Input
                    aria-label={`Должность, строка ${index + 1}`}
                    placeholder="Должность *"
                    required
                    maxLength={100}
                    value={row.position}
                    onChange={(e) => patch(setLeaders, row.key, { position: e.target.value })}
                  />
                  <Input
                    aria-label={`Короткое название, строка ${index + 1}`}
                    placeholder="Коротко"
                    maxLength={40}
                    value={row.shortTitle}
                    onChange={(e) => patch(setLeaders, row.key, { shortTitle: e.target.value })}
                  />
                  <Select
                    value={row.membershipId}
                    onChange={(e) =>
                      patch(setLeaders, row.key, { membershipId: e.target.value })
                    }
                  >
                    <option value={FREE_PERSON}>Не участник — вписать имя</option>
                    {/* Участник вышел из проекта — строка со своим снимком остаётся. */}
                    {row.membershipId && !member ? (
                      <option value={row.membershipId}>
                        {row.personName || "Участник"} — вышел из проекта
                      </option>
                    ) : null}
                    {members.map((m) => (
                      <option key={m.membershipId} value={m.membershipId}>
                        {m.label} · {m.roleName}
                      </option>
                    ))}
                  </Select>
                  {row.membershipId ? (
                    <p className="text-xs text-[var(--muted-fg)] sm:col-span-3">
                      {sameAsStored
                        ? `${row.personName || "—"}${row.phone ? ` · ${row.phone}` : ""} — как в вызывном.`
                        : "ФИ и телефон возьмутся из профиля участника при сохранении."}
                    </p>
                  ) : (
                    <>
                      <Input
                        aria-label={`Имя, строка ${index + 1}`}
                        placeholder="Имя и фамилия"
                        maxLength={200}
                        className="sm:col-span-2"
                        value={row.personName}
                        onChange={(e) =>
                          patch(setLeaders, row.key, { personName: e.target.value })
                        }
                      />
                      <Input
                        aria-label={`Телефон, строка ${index + 1}`}
                        placeholder="Телефон"
                        type="tel"
                        maxLength={30}
                        value={row.phone}
                        onChange={(e) => patch(setLeaders, row.key, { phone: e.target.value })}
                      />
                    </>
                  )}
                </div>
                <RemoveButton
                  label={`Убрать строку ${index + 1}`}
                  onClick={() => setLeaders((rows) => rows.filter((r) => r.key !== row.key))}
                />
              </>
            );
          }}
        />
      </Section>

      <Section
        title="Цеха и вызов"
        hint="Цех проекта или своя строка и время вызова в этот день. Название можно поправить."
        addLabel="+ Цех"
        empty={crewCalls.length === 0}
        onAdd={() =>
          setCrewCalls((rows) => [
            ...rows,
            { key: newKey(), departmentId: OWN_ROW, label: "", callTime: "" },
          ])
        }
      >
        <SortableRows
          rows={crewCalls}
          onReorder={setCrewCalls}
          renderRow={(row, index) => (
            <>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1fr_6rem]">
                <Select
                  value={row.departmentId}
                  onChange={(e) => {
                    const departmentId = e.target.value;
                    patch(setCrewCalls, row.key, {
                      departmentId,
                      label: departmentById.get(departmentId) ?? row.label,
                    });
                  }}
                >
                  <option value={OWN_ROW}>Своя строка</option>
                  {row.departmentId && !departmentById.has(row.departmentId) ? (
                    <option value={row.departmentId} disabled>
                      Цех удалён
                    </option>
                  ) : null}
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Название, строка ${index + 1}`}
                  placeholder={row.departmentId ? "Как у цеха" : "Название *"}
                  required={!row.departmentId}
                  maxLength={100}
                  value={row.label}
                  onChange={(e) => patch(setCrewCalls, row.key, { label: e.target.value })}
                />
                <HhMmInput
                  aria-label={`Время вызова, строка ${index + 1}`}
                  value={row.callTime}
                  onChange={(value) => patch(setCrewCalls, row.key, { callTime: value })}
                />
              </div>
              <RemoveButton
                label={`Убрать строку ${index + 1}`}
                onClick={() => setCrewCalls((rows) => rows.filter((r) => r.key !== row.key))}
              />
            </>
          )}
        />
      </Section>

      <Section
        title="База и транспорт группы"
        hint="Наименование, время в этот день или «не нужен»."
        addLabel="+ Строка"
        empty={baseItems.length === 0}
        onAdd={() =>
          setBaseItems((rows) => [
            ...rows,
            { key: newKey(), name: "", callTime: "", notNeeded: false },
          ])
        }
      >
        <SortableRows
          rows={baseItems}
          onReorder={setBaseItems}
          renderRow={(row, index) => (
            <>
              <div className="grid min-w-0 flex-1 items-center gap-2 sm:grid-cols-[1fr_6rem_auto]">
                <Input
                  aria-label={`Наименование, строка ${index + 1}`}
                  placeholder="Наименование *"
                  required
                  maxLength={200}
                  value={row.name}
                  onChange={(e) => patch(setBaseItems, row.key, { name: e.target.value })}
                />
                <HhMmInput
                  aria-label={`Время, строка ${index + 1}`}
                  value={row.callTime}
                  onChange={(value) => patch(setBaseItems, row.key, { callTime: value })}
                />
                <Checkbox
                  checked={row.notNeeded}
                  onChange={(e) =>
                    patch(setBaseItems, row.key, { notNeeded: e.target.checked })
                  }
                >
                  Не нужен
                </Checkbox>
              </div>
              <RemoveButton
                label={`Убрать строку ${index + 1}`}
                onClick={() => setBaseItems((rows) => rows.filter((r) => r.key !== row.key))}
              />
            </>
          )}
        />
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)]/60 pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Сохранить вызывной"}
        </Button>
        <p className="text-xs text-[var(--muted-fg)]">
          Меняется только этот вызывной, шаблон проекта остаётся как был.
        </p>
      </div>
    </form>
  );
}
