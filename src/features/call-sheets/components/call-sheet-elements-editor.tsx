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
  saveCallSheetElementsAction,
  type CallSheetElementsActionState,
} from "@/features/call-sheets/elements-actions";
import type { ElementsEditorData } from "@/features/call-sheets/elements-queries";
import {
  MAX_ELEMENT_NAME,
  MAX_ELEMENT_NOTES,
  MAX_ELEMENT_QUANTITY,
  MAX_ELEMENT_SCENES,
} from "@/features/call-sheets/lib/elements-rules";
import { SPECIAL_TRANSPORT_KEY, type ElementValues } from "@/features/call-sheets/lib/sections";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

type AutoRow = ElementsEditorData["autoRows"][number];
type Orphan = ElementsEditorData["orphans"][number];
type ManualRow = ElementValues & { rowKey: string };

const initial: CallSheetElementsActionState = {};

const EMPTY_VALUES: ElementValues = {
  name: "",
  quantity: "",
  scenes: "",
  arrivalTime: "",
  readyTime: "",
  wrapTime: "",
  notes: "",
  secondUnit: false,
};

function stripRowKey(row: ManualRow): ElementValues {
  const rest: Partial<ManualRow> = { ...row };
  delete rest.rowKey;
  return rest as ElementValues;
}

/** Поля строки: что, кол-во, сцены, прибытие, готов, конец, примечание, 2-й юнит. */
function ElementFields({
  label,
  value,
  onChange,
  placeholders,
  nameRequired,
}: {
  label: string;
  value: ElementValues;
  onChange: (change: Partial<ElementValues>) => void;
  placeholders?: { name: string; quantity: string; scenes: string };
  nameRequired: boolean;
}) {
  return (
    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(9rem,2fr)_4.5rem_minmax(5rem,1fr)_5.25rem_5.25rem_5.25rem]">
      <Input
        aria-label={`Что, ${label}`}
        placeholder={placeholders?.name || (nameRequired ? "Что *" : "Что")}
        required={nameRequired}
        maxLength={MAX_ELEMENT_NAME}
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <Input
        aria-label={`Количество, ${label}`}
        placeholder={placeholders?.quantity || "Кол-во"}
        maxLength={MAX_ELEMENT_QUANTITY}
        value={value.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
      />
      <Input
        aria-label={`Сцены, ${label}`}
        placeholder={placeholders?.scenes || "Сцены"}
        maxLength={MAX_ELEMENT_SCENES}
        value={value.scenes}
        onChange={(e) => onChange({ scenes: e.target.value })}
      />
      <HhMmInput
        aria-label={`Прибытие, ${label}`}
        title="Прибытие"
        value={value.arrivalTime}
        onChange={(v) => onChange({ arrivalTime: v })}
      />
      <HhMmInput
        aria-label={`Готов, ${label}`}
        title="Готов"
        value={value.readyTime}
        onChange={(v) => onChange({ readyTime: v })}
      />
      <HhMmInput
        aria-label={`Конец, ${label}`}
        title="Конец"
        value={value.wrapTime}
        onChange={(v) => onChange({ wrapTime: v })}
      />
      <Input
        aria-label={`Примечание, ${label}`}
        placeholder="Примечание"
        maxLength={MAX_ELEMENT_NOTES}
        className="sm:col-span-5"
        value={value.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
      />
      <Checkbox
        checked={value.secondUnit}
        onChange={(e) => onChange({ secondUnit: e.target.checked })}
      >
        2-й юнит
      </Checkbox>
    </div>
  );
}

function SortableRow({
  id,
  children,
  canEdit,
}: {
  id: string;
  children: ReactNode;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2.5 text-sm",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      {canEdit ? (
        <button
          type="button"
          className="mt-2 cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
          aria-label="Перетащить строку"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      ) : null}
      {children}
    </div>
  );
}

/** Ручные строки раздела с перетаскиванием. */
function ManualRows({
  sectionName,
  rows,
  canEdit,
  onChange,
}: {
  sectionName: string;
  rows: ManualRow[];
  canEdit: boolean;
  onChange: (rows: ManualRow[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const dndId = useId();

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.rowKey === active.id);
    const newIndex = rows.findIndex((r) => r.rowKey === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(rows, oldIndex, newIndex));
  }

  if (rows.length === 0) return null;
  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rows.map((r) => r.rowKey)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <SortableRow key={row.rowKey} id={row.rowKey} canEdit={canEdit}>
              <ElementFields
                label={`${sectionName}, строка ${index + 1}`}
                value={row}
                nameRequired
                onChange={(change) =>
                  onChange(rows.map((r) => (r.rowKey === row.rowKey ? { ...r, ...change } : r)))
                }
              />
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Удалить строку ${index + 1} раздела «${sectionName}»`}
                  title="Удалить строку"
                  onClick={() => onChange(rows.filter((r) => r.rowKey !== row.rowKey))}
                >
                  ✕
                </Button>
              ) : null}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** Авто-строка из сцен дня: правка полей, «убрать из вызывного» / «вернуть». */
function AutoRowView({
  row,
  sectionName,
  index,
  canEdit,
  onChange,
}: {
  row: AutoRow;
  sectionName: string;
  index: number;
  canEdit: boolean;
  onChange: (change: Partial<AutoRow>) => void;
}) {
  if (row.hidden) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border)]/60 px-3 py-2 text-sm text-[var(--muted-fg)]">
        <span className="line-through">{row.value.name || row.auto.name}</span>
        <span className="text-xs">· убрано из этого вызывного</span>
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto"
            onClick={() => onChange({ hidden: false })}
          >
            Вернуть
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2.5 text-sm">
      <span
        className="mt-2 rounded bg-[var(--accent)]/15 px-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--accent)]"
        title="Строка из разбора сцен дня. Пустое поле — значение из сцен."
      >
        сцены
      </span>
      <ElementFields
        label={`${sectionName}, строка из сцен ${index + 1}`}
        value={row.value}
        placeholders={row.auto}
        nameRequired={false}
        onChange={(change) => onChange({ value: { ...row.value, ...change } })}
      />
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          title="Убрать строку из этого вызывного (в сценах она останется)"
          onClick={() => onChange({ hidden: true })}
        >
          Убрать
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Элементы площадки вызывного: по разделам — строки из разбора сцен дня (с правками) и
 * ручные строки. Спецтранспорт — только показ. Сохраняется одной кнопкой.
 */
export function CallSheetElementsEditor({
  projectId,
  dayId,
  data,
  canEdit,
}: {
  projectId: string;
  dayId: string;
  data: ElementsEditorData;
  canEdit: boolean;
}) {
  const bound = saveCallSheetElementsAction.bind(null, projectId, dayId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(canEdit, undefined, state);
  useActionSuccess(state, markClean);

  const nextKey = useRef(0);
  const newKey = () => `n${nextKey.current++}`;

  const [autoRows, setAutoRows] = useState<AutoRow[]>(data.autoRows);
  const [orphans, setOrphans] = useState<Orphan[]>(data.orphans);
  const [manual, setManual] = useState<Record<string, ManualRow[]>>(() => {
    const bySection: Record<string, ManualRow[]> = {};
    data.manual.forEach((row, index) => {
      const { sectionRef, ...values } = row;
      (bySection[sectionRef] ??= []).push({ ...values, rowKey: `m${index}` });
    });
    return bySection;
  });

  const sectionRefs = data.sections.map((s) => s.ref);
  const manualRefs = [
    ...sectionRefs,
    ...Object.keys(manual).filter((ref) => !sectionRefs.includes(ref)),
  ];
  const payload = JSON.stringify({
    autoEdits: autoRows.map((row) => ({ autoKey: row.autoKey, hidden: row.hidden, ...row.value })),
    keepOrphans: orphans.map((row) => row.autoKey),
    manual: manualRefs.flatMap((ref) =>
      (manual[ref] ?? []).map((row) => ({ section: ref, ...stripRowKey(row) })),
    ),
  });

  function patchAuto(autoKey: string, change: Partial<AutoRow>) {
    setAutoRows((rows) => rows.map((r) => (r.autoKey === autoKey ? { ...r, ...change } : r)));
  }

  return (
    <form ref={ref} onSubmit={submitKeepingFields(action)} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <p className="text-xs text-[var(--muted-fg)]">
        Строки с пометкой «сцены» — из разбора сцен дня (вырезанные сцены не учитываются). Их можно
        поправить или убрать из этого вызывного; пустое поле — значение из сцен. Ручные строки
        добавляются кнопкой «+ Строка», порядок — перетаскиванием за ⠿.
      </p>

      <fieldset disabled={!canEdit} className="space-y-6">
        {data.sections.map((section) => {
          const sectionAuto = autoRows.filter((row) => row.sectionRef === section.ref);
          const rows = manual[section.ref] ?? [];
          const isSpecial = section.key === SPECIAL_TRANSPORT_KEY;
          const empty =
            sectionAuto.length === 0 &&
            rows.length === 0 &&
            (!isSpecial || data.specialTransport.length === 0);
          return (
            <section key={section.ref} className="space-y-2">
              <h4 className="text-sm font-semibold">{section.name}</h4>
              {isSpecial ? (
                <>
                  {data.specialTransport.length > 0 ? (
                    <ul className="space-y-1 text-sm">
                      {data.specialTransport.map((row, index) => (
                        <li
                          key={index}
                          className="flex flex-wrap gap-x-3 rounded-lg border border-[var(--border)]/60 px-3 py-2"
                        >
                          <span className="font-medium">{row.name}</span>
                          {row.scenes ? <span>сц. {row.scenes}</span> : null}
                          <span className="tabular-nums text-[var(--muted-fg)]">
                            {row.callTime ?? "—"}–{row.wrapTime ?? "—"}
                          </span>
                          {row.notes ? (
                            <span className="text-[var(--muted-fg)]">{row.notes}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-xs text-[var(--muted-fg)]">
                    Правится в блоке «Спецтранспорт».
                  </p>
                </>
              ) : null}
              {empty && !isSpecial ? (
                <p className="text-sm text-[var(--muted-fg)]">Строк нет.</p>
              ) : null}
              {sectionAuto.length > 0 ? (
                <div className="space-y-2">
                  {sectionAuto.map((row, index) => (
                    <AutoRowView
                      key={row.autoKey}
                      row={row}
                      sectionName={section.name}
                      index={index}
                      canEdit={canEdit}
                      onChange={(change) => patchAuto(row.autoKey, change)}
                    />
                  ))}
                </div>
              ) : null}
              <ManualRows
                sectionName={section.name}
                rows={rows}
                canEdit={canEdit}
                onChange={(next) => setManual((all) => ({ ...all, [section.ref]: next }))}
              />
              {canEdit && !isSpecial ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setManual((all) => ({
                      ...all,
                      [section.ref]: [...(all[section.ref] ?? []), { ...EMPTY_VALUES, rowKey: newKey() }],
                    }))
                  }
                >
                  + Строка
                </Button>
              ) : null}
            </section>
          );
        })}

        {orphans.length > 0 ? (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Нет в сценах дня</h4>
            <p className="text-xs text-[var(--muted-fg)]">
              Правки строк, которых больше нет в сценах этого дня (сцену убрали из дня, вырезали или
              поменяли разбор). Если строка вернётся в сцены — правка снова применится. Ненужные
              удалите и сохраните.
            </p>
            {orphans.map((row) => (
              <div
                key={row.autoKey}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--danger)]/40 px-3 py-2 text-sm"
              >
                <span className="font-medium">{row.name}</span>
                {row.sectionName ? (
                  <span className="text-xs text-[var(--muted-fg)]">{row.sectionName}</span>
                ) : null}
                {row.quantity ? <span>× {row.quantity}</span> : null}
                {row.scenes ? <span>сц. {row.scenes}</span> : null}
                {row.hidden ? (
                  <span className="text-xs text-[var(--muted-fg)]">было убрано</span>
                ) : null}
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() =>
                      setOrphans((rows) => rows.filter((r) => r.autoKey !== row.autoKey))
                    }
                  >
                    Удалить правку
                  </Button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)]/60 pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? "…" : "Сохранить элементы площадки"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
