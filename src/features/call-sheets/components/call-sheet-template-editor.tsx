"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  saveCallSheetTemplateAction,
  type CallSheetTemplateActionState,
} from "@/features/call-sheets/actions";
import type {
  TemplateEditorData,
  TemplateMemberOption,
} from "@/features/call-sheets/queries";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

type Leader = TemplateEditorData["leaders"][number] & { key: string };
type CrewCall = TemplateEditorData["crewCalls"][number] & { key: string };
type BaseItem = TemplateEditorData["baseItems"][number] & { key: string };

const initial: CallSheetTemplateActionState = {};
const FREE_PERSON = "";
const OWN_ROW = "";

function withKeys<T>(rows: T[], prefix: string): (T & { key: string })[] {
  return rows.map((row, index) => ({ ...row, key: `${prefix}${index}` }));
}

function stripKey<T extends { key: string }>(rows: T[]): Omit<T, "key">[] {
  return rows.map((row) => {
    const rest: Partial<T> = { ...row };
    delete rest.key;
    return rest as Omit<T, "key">;
  });
}

/** Список строк с перетаскиванием за ⠿. */
function SortableRows<T extends { key: string }>({
  rows,
  onReorder,
  renderRow,
}: {
  rows: T[];
  onReorder: (rows: T[]) => void;
  renderRow: (row: T, index: number) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // Постоянный id: иначе служебные aria-атрибуты dnd-kit на сервере и в браузере расходятся.
  const dndId = useId();

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.key === active.id);
    const newIndex = rows.findIndex((r) => r.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(rows, oldIndex, newIndex));
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <SortableRow key={row.key} id={row.key}>
              {renderRow(row, index)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2.5 text-sm",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        className="mt-2 cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
        aria-label="Перетащить строку"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {children}
    </div>
  );
}

function Section({
  title,
  hint,
  addLabel,
  onAdd,
  empty,
  children,
}: {
  title: string;
  hint: string;
  addLabel: string;
  onAdd: () => void;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted-fg)]">{hint}</p>
      </div>
      {empty ? (
        <p className="text-sm text-[var(--muted-fg)]">Строк пока нет.</p>
      ) : (
        children
      )}
      <Button type="button" variant="secondary" onClick={onAdd}>
        {addLabel}
      </Button>
    </section>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" aria-label={label} title={label} onClick={onClick}>
      ✕
    </Button>
  );
}

export function CallSheetTemplateEditor({
  projectId,
  template,
  members,
  departments,
}: {
  projectId: string;
  template: TemplateEditorData;
  members: TemplateMemberOption[];
  departments: { id: string; name: string }[];
}) {
  const bound = saveCallSheetTemplateAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(true, undefined, state);
  useActionSuccess(state, markClean);

  const nextKey = useRef(0);
  const newKey = () => `n${nextKey.current++}`;

  const [leaders, setLeaders] = useState<Leader[]>(() => withKeys(template.leaders, "l"));
  const [crewCalls, setCrewCalls] = useState<CrewCall[]>(() =>
    withKeys(template.crewCalls, "c"),
  );
  const [baseItems, setBaseItems] = useState<BaseItem[]>(() =>
    withKeys(template.baseItems, "b"),
  );

  const memberById = new Map(members.map((m) => [m.membershipId, m]));
  const departmentIds = new Set(departments.map((d) => d.id));

  const payload = JSON.stringify({
    leaders: stripKey(leaders),
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

      <Section
        title="Руководители группы"
        hint="Должность, короткое название и человек. Участник проекта — ФИ и телефон из его профиля; иначе впишите имя и телефон."
        addLabel="+ Руководитель"
        empty={leaders.length === 0}
        onAdd={() =>
          setLeaders((rows) => [
            ...rows,
            { key: newKey(), position: "", shortTitle: "", membershipId: "", personName: "", phone: "" },
          ])
        }
      >
        <SortableRows
          rows={leaders}
          onReorder={setLeaders}
          renderRow={(row, index) => {
            const member = row.membershipId ? memberById.get(row.membershipId) : undefined;
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
                    {/* Участник ушёл из проекта — строка остаётся, выбрать его снова нельзя. */}
                    {row.membershipId && !member ? (
                      <option value={row.membershipId} disabled>
                        Участник не активен
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
                      {member
                        ? member.hasPhone
                          ? "ФИ и телефон — из профиля участника."
                          : "ФИ — из профиля участника. Телефона в профиле нет."
                        : "Участник не активен — выберите другого или впишите имя."}
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
        hint="Цех проекта или своя строка (каскадёры, рабочие…) и время вызова по умолчанию."
        addLabel="+ Цех"
        empty={crewCalls.length === 0}
        onAdd={() =>
          setCrewCalls((rows) => [
            ...rows,
            { key: newKey(), departmentId: departments[0]?.id ?? OWN_ROW, label: "", callTime: "" },
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
                  onChange={(e) =>
                    patch(setCrewCalls, row.key, { departmentId: e.target.value })
                  }
                >
                  <option value={OWN_ROW}>Своя строка</option>
                  {row.departmentId && !departmentIds.has(row.departmentId) ? (
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
                {row.departmentId ? (
                  <span className="hidden sm:block" />
                ) : (
                  <Input
                    aria-label={`Название, строка ${index + 1}`}
                    placeholder="Название *"
                    required
                    maxLength={100}
                    value={row.label}
                    onChange={(e) => patch(setCrewCalls, row.key, { label: e.target.value })}
                  />
                )}
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
        hint="Наименование и время по умолчанию. «Не нужен» — строка по умолчанию отмечена как ненужная."
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
          {pending ? "…" : "Сохранить шаблон"}
        </Button>
        <p className="text-xs text-[var(--muted-fg)]">
          Новый вызывной получает копию шаблона. Уже созданные вызывные не меняются — в них есть
          кнопка «Обновить из шаблона».
        </p>
      </div>
    </form>
  );
}
