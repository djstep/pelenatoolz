"use client";

import { Archive, ChevronDown, ChevronRight, Columns3 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  addLineAction,
  addSubarticleAction,
  moveItemsNodeAction,
  renameSubarticleAction,
  setItemsNodeArchivedAction,
  takeTemplateArticleAction,
  updateLineAction,
  type ItemsActionState,
} from "@/features/smeta/items-actions";
import type {
  DepartmentItemsTree,
  ItemsDictionaries,
  MoneyTotals,
  TreeArticle,
  TreeLine,
  TreeSubarticle,
} from "@/features/smeta/items-queries";
import { BudgetItemsImport } from "@/features/smeta/components/budget-items-import";
import { BudgetMultipliersModal, multipliersText, type VariableOption } from "@/features/smeta/components/budget-multipliers-modal";
import { useCollapsedIds } from "@/features/smeta/components/use-collapsed-ids";
import { useStoredString } from "@/features/smeta/components/use-stored-string";
import type { ItemProblem } from "@/features/smeta/lib/item-calc";
import {
  ACTIONS_WIDTH,
  ALWAYS_COLUMNS,
  COLUMNS,
  COLUMNS_KEY,
  DEFAULT_COLUMNS,
  layoutOf,
  NAME_MIN_WIDTH,
  parseVisibleColumns,
  type ColumnDef,
  type ColumnKey,
  type ColumnsLayout,
} from "@/features/smeta/lib/item-columns";
import {
  draftFromLine,
  draftToPayload,
  EMPTY_DRAFT,
  formatMoney,
  isEmptyDraft,
  previewDraft,
  sameDraft,
  type DraftSlot,
  type LineDraft,
} from "@/features/smeta/lib/line-draft";
import { useOnChange } from "@/shared/hooks/use-on-change";
import { cn } from "@/shared/lib/cn";
import { countOf } from "@/shared/lib/plural";
import { Button } from "@/shared/ui/button";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";

/** Единицы — подсказки поля; можно вписать свою. */
const UNITS = ["смена", "день", "неделя", "месяц", "час", "шт.", "км", "серия", "комплект", "услуга"];

/** Несохранённые строки таблицы: ключ строки → сохранить (true — сохранилось). */
export type DirtyRows = Map<string, () => Promise<boolean>>;

// ---------------------------------------------------------------------------
// Общее для строк
// ---------------------------------------------------------------------------

type TableContext = {
  projectId: string;
  departmentId: string;
  canWrite: boolean;
  variables: VariableOption[];
  variableValues: Map<string, string | null>;
  dictionaries: ItemsDictionaries;
  dirtyRows: DirtyRows;
  onRevision: (revision: number) => void;
  run: (call: () => Promise<ItemsActionState>, after?: (r: ItemsActionState) => void) => void;
  busy: boolean;
  layout: ColumnsLayout;
  /** Строка, в которой сейчас фокус (ключ), — у неё видны скрытые колонки. */
  activeKey: string | null;
  /** Событие фокуса или нажатия пришло из строки key (в том числе из её списков и окон). */
  mark: (event: Event, key: string) => void;
  /** Что сделать, когда фокус ушёл из строки целиком: сохранить. */
  leaves: Map<string, () => void>;
  /** Enter: перейти на следующую строку подстатьи; false — это была последняя. */
  focusNext: (key: string, subId: string, field: string) => boolean;
  /** Новые строки добавляются по очереди — в том порядке, в каком их ввели. */
  enqueue: (task: () => Promise<void>) => void;
};

const cellInput =
  "h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-70";
const numberInput = `${cellInput} text-right tabular-nums`;
const moneyCell = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

function moneyOf(totals: Pick<MoneyTotals, "amount" | "tax" | "total">, key: ColumnKey): string | null {
  return key === "amount" ? totals.amount : key === "tax" ? totals.tax : totals.total;
}

function MoneyCells({
  totals,
  columns,
  strong,
}: {
  totals: Pick<MoneyTotals, "amount" | "tax" | "total">;
  columns: ColumnDef[];
  strong?: boolean;
}) {
  return (
    <>
      {columns.map((c) => (
        <td key={c.key} className={cn(moneyCell, strong && c.key === "total" && "font-semibold")}>
          {formatMoney(moneyOf(totals, c.key))}
        </td>
      ))}
    </>
  );
}

/** Почему у строки нет суммы — словами, с названиями переменных. */
function problemText(problems: readonly ItemProblem[], variables: readonly VariableOption[]): string {
  const missing = problems.flatMap((p) =>
    p.kind === "variable_missing" ? [variables.find((v) => v.id === p.variableId)?.label ?? "удалена"] : [],
  );
  if (missing.length > 0) return `не задана переменная: ${missing.join(", ")}`;
  const fields = [
    problems.some((p) => p.kind === "no_quantity") ? "кол-во" : null,
    problems.some((p) => p.kind === "no_rate") ? "ставка" : null,
  ].filter(Boolean);
  return fields.length > 0 ? `не заполнено: ${fields.join(", ")}` : "";
}

// ---------------------------------------------------------------------------
// Строка (и новая строка)
// ---------------------------------------------------------------------------

function LineRow({
  line,
  subId,
  ctx,
  index = -1,
  count = 0,
  onEnterLast,
  onCloseNew,
}: {
  /** null — новая строка в конце подстатьи. */
  line: TreeLine | null;
  subId: string;
  ctx: TableContext;
  index?: number;
  count?: number;
  onEnterLast?: () => void;
  onCloseNew?: () => void;
}) {
  const router = useRouter();
  const isNew = line === null;
  const key = line ? line.id : `new:${subId}`;
  const initial = useMemo(() => (line ? draftFromLine(line) : EMPTY_DRAFT), [line]);
  const [draft, setDraft] = useState<LineDraft>(initial);
  /** Строка с сервера (или только что сохранённая), от которой идут правки. */
  const [base, setBase] = useState<LineDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [multipliersOpen, setMultipliersOpen] = useState(false);
  // С сервера пришла строка: если своих правок нет (или их только что сохранили) — показать её;
  // набранное, но не сохранённое не трогаем.
  useOnChange([initial], () => {
    setBase(initial);
    if (sameDraft(draft, base)) setDraft(initial);
  });
  const dirty = isNew ? !isEmptyDraft(draft) : !sameDraft(draft, base);
  const editable = ctx.canWrite && !line?.archived;
  const active = editable && ctx.activeKey === key;
  const preview = useMemo(() => previewDraft(draft, ctx.variableValues), [draft, ctx.variableValues]);
  // Суммы с сервера — пока в полях то же, что пришло с сервера; иначе (правка или только что
  // сохранили, а свежие данные ещё в пути) — расчёт на экране.
  const shown =
    line && sameDraft(draft, initial)
      ? { amount: line.amount, tax: line.tax, total: line.total, problems: line.problems, invalid: [] }
      : preview;
  /** Сохранение, которое идёт сейчас: повторный вызов с теми же данными ждёт его, а не шлёт ещё раз. */
  const inflight = useRef<{ draft: LineDraft; promise: Promise<boolean> } | null>(null);

  function check(d: LineDraft): string | null {
    if (previewDraft(d, ctx.variableValues).invalid.length > 0) {
      return "Проверьте числа: количество, ставка, налог и множители — числа от 0";
    }
    if (!d.name.trim()) return "Введите наименование";
    return null;
  }

  async function saveExisting(snapshot: LineDraft): Promise<boolean> {
    setSaving(true);
    try {
      const result = await updateLineAction(ctx.projectId, ctx.departmentId, line!.id, draftToPayload(snapshot));
      if (result.error) {
        setError(result.error);
        return false;
      }
      setError(null);
      if (result.revision) ctx.onRevision(result.revision);
      // Сохранённое — новая основа: то, что набрали после нажатия, остаётся правкой.
      setBase(snapshot);
      router.refresh();
      return true;
    } catch {
      setError("Нет связи с сервером — строка не сохранена");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Новая строка: поле сразу очищается под следующую, строка добавляется по очереди. */
  function submitNew(snapshot: LineDraft): Promise<boolean> {
    setDraft(EMPTY_DRAFT);
    setError(null);
    return new Promise((resolve) => {
      ctx.enqueue(async () => {
        try {
          const result = await addLineAction(ctx.projectId, ctx.departmentId, subId, draftToPayload(snapshot));
          if (result.error) throw new Error(result.error);
          if (result.revision) ctx.onRevision(result.revision);
          router.refresh();
          resolve(true);
        } catch (e) {
          const message = e instanceof Error && e.message ? e.message : "Нет связи с сервером";
          // Набранное не теряем: если новая строка открыта и пуста — вернуть набранное туда,
          // иначе — сообщить с названием.
          if (isEmptyDraft(draftRef.current)) {
            setDraft(snapshot);
            setError(`Строка не добавлена: ${message}`);
          } else {
            toast.error(`Строка «${snapshot.name.trim()}» не добавлена: ${message}`);
          }
          resolve(false);
        }
      });
    });
  }

  function save(): Promise<boolean> {
    if (!dirty) return Promise.resolve(true);
    const problem = check(draft);
    if (problem) {
      setError(problem);
      return Promise.resolve(false);
    }
    if (isNew) return submitNew(draft);
    if (inflight.current && sameDraft(inflight.current.draft, draft)) return inflight.current.promise;
    const snapshot = draft;
    const promise = saveExisting(snapshot).finally(() => {
      if (inflight.current?.promise === promise) inflight.current = null;
    });
    inflight.current = { draft: snapshot, promise };
    return promise;
  }

  /** Фокус ушёл из строки: сохранить. Новую строку после этого закрыть (пустую — сразу). */
  function leave() {
    if (isNew && isEmptyDraft(draft)) {
      setError(null);
      onCloseNew?.();
      return;
    }
    if (isNew && check(draft)) {
      setError(check(draft));
      return;
    }
    // Новую строку закрыть, когда она добавится, — если в неё не вернулись и ничего не набрали.
    void save().then((ok) => {
      if (isNew && ok && isEmptyDraft(draftRef.current) && !rowRef.current?.contains(document.activeElement)) onCloseNew?.();
    });
  }

  // Для общих механизмов (уход со страницы, уход из строки) — всегда свежие версии.
  const saveRef = useRef(save);
  const leaveRef = useRef(leave);
  const draftRef = useRef(draft);
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    saveRef.current = save;
    leaveRef.current = leave;
    draftRef.current = draft;
  });

  const { dirtyRows, leaves } = ctx;
  useEffect(() => {
    if (!dirty) return;
    dirtyRows.set(key, () => saveRef.current());
    return () => {
      dirtyRows.delete(key);
    };
  }, [dirty, dirtyRows, key]);
  useEffect(() => {
    leaves.set(key, () => leaveRef.current());
    return () => {
      leaves.delete(key);
    };
  }, [leaves, key]);

  function update(patch: Partial<LineDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function cancel() {
    setError(null);
    if (isNew) {
      setDraft(EMPTY_DRAFT);
      onCloseNew?.();
    } else setDraft(base);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    // Клавиши из списков и окна множителей (они в своих слоях поверх страницы) — их дело.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && !(target instanceof HTMLButtonElement) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (isNew) {
        // Добавить и сразу вводить следующую: фокус — в наименование пустой новой строки.
        void saveRef.current();
        document.getElementById(`${id}-name`)?.focus();
        return;
      }
      void saveRef.current();
      if (!ctx.focusNext(key, subId, target.dataset.field ?? "name")) onEnterLast?.();
    } else if (event.key === "Escape") {
      if (target.getAttribute("aria-expanded") === "true") return; // Esc закрывает открытый список
      event.preventDefault();
      cancel();
    }
  }

  const rowEvents = {
    onKeyDown,
    onFocus: (e: ReactFocusEvent) => ctx.mark(e.nativeEvent, key),
    onPointerDown: (e: ReactPointerEvent) => ctx.mark(e.nativeEvent, key),
  };

  const forms = ctx.dictionaries.paymentForms.filter((f) => !f.archived || f.id === draft.paymentFormId);
  const types = ctx.dictionaries.expenseTypes.filter((t) => !t.archived || t.id === draft.expenseTypeId);
  const id = line ? `line-${line.id}` : `new-line-${subId}`;
  const problem = shown.total == null ? problemText(shown.problems, ctx.variables) : "";

  function control(column: ColumnKey): ReactNode {
    switch (column) {
      case "type":
        return (
          <>
            <label className="sr-only" htmlFor={`${id}-type-trigger`}>Тип расхода</label>
            <Select
              id={`${id}-type`}
              className="h-8"
              value={draft.expenseTypeId}
              disabled={!editable}
              onChange={(e) => update({ expenseTypeId: e.target.value })}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </>
        );
      case "unit":
        return (
          <>
            <label className="sr-only" htmlFor={`${id}-unit`}>Единица</label>
            <input
              id={`${id}-unit`}
              data-field="unit"
              className={cellInput}
              list="budget-units"
              value={draft.unit}
              disabled={!editable}
              maxLength={40}
              onChange={(e) => update({ unit: e.target.value })}
            />
          </>
        );
      case "quantity":
      case "rate":
      case "taxPercent": {
        const label = column === "quantity" ? "Количество" : column === "rate" ? "Ставка" : "Налог, %";
        const inputId = `${id}-${column === "taxPercent" ? "tax" : column}`;
        return (
          <>
            <label className="sr-only" htmlFor={inputId}>{label}</label>
            <input
              id={inputId}
              data-field={column}
              className={cn(numberInput, preview.invalid.includes(column) && "border-[var(--danger)]")}
              inputMode="decimal"
              value={draft[column]}
              disabled={!editable}
              onChange={(e) => update({ [column]: e.target.value } as Partial<LineDraft>)}
            />
          </>
        );
      }
      case "multipliers":
        return (
          <>
            <button
              type="button"
              id={`${id}-multipliers`}
              aria-label="Множители"
              className={cn(
                cellInput,
                "truncate text-left",
                preview.invalid.includes("multipliers") && "border-[var(--danger)]",
                !editable && "cursor-default",
              )}
              disabled={!editable}
              title={multipliersText(draft.slots, ctx.variables) || "Без множителей"}
              onClick={() => setMultipliersOpen(true)}
            >
              {multipliersText(draft.slots, ctx.variables) || <span className="text-[var(--muted)]">+ множитель</span>}
            </button>
            {multipliersOpen ? (
              // Окно — внутри строки (в дереве React): фокус в нём — это фокус в строке.
              <BudgetMultipliersModal
                open
                slots={draft.slots}
                variables={ctx.variables}
                onClose={() => {
                  setMultipliersOpen(false);
                  // Фокус — обратно на кнопку множителей, чтобы продолжить с клавиатуры.
                  requestAnimationFrame(() => document.getElementById(`${id}-multipliers`)?.focus());
                }}
                onApply={(slots: [DraftSlot, DraftSlot, DraftSlot]) => update({ slots })}
              />
            ) : null}
          </>
        );
      case "paymentForm":
        return (
          <>
            <label className="sr-only" htmlFor={`${id}-form-trigger`}>Форма оплаты</label>
            <Select
              id={`${id}-form`}
              className="h-8"
              value={draft.paymentFormId}
              disabled={!editable}
              onChange={(e) => {
                const form = ctx.dictionaries.paymentForms.find((f) => f.id === e.target.value);
                // Налог % подставляется из формы оплаты; его можно поменять.
                update({
                  paymentFormId: e.target.value,
                  taxPercent: form?.defaultTaxPercent?.replace(".", ",") ?? "",
                });
              }}
            >
              <option value="">—</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </>
        );
      default:
        return null;
    }
  }

  const { layout } = ctx;
  const hiddenEditable = layout.hidden.filter((c) => !c.money);
  const hiddenMoney = layout.hidden.filter((c) => c.money);
  const showDetails = active && (hiddenEditable.length > 0 || hiddenMoney.length > 0);
  const lineName = line?.name ?? "";

  let actions: ReactNode = null;
  if (ctx.canWrite && isNew) {
    actions = (
      <span className="inline-flex items-center gap-0.5">
        <Button type="button" tabIndex={-1} className="h-8 px-2 text-xs" disabled={!dirty} onClick={() => void saveRef.current()}>
          Добавить
        </Button>
        <Button type="button" tabIndex={-1} variant="ghost" className="h-8 px-2" aria-label="Отменить новую строку" onClick={cancel}>
          ×
        </Button>
      </span>
    );
  } else if (ctx.canWrite && line?.archived) {
    actions = (
      <Button
        type="button"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={ctx.busy}
        onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "line", line.id, false))}
      >
        Вернуть
      </Button>
    );
  } else if (ctx.canWrite && line) {
    actions = dirty ? (
      <Button type="button" tabIndex={-1} className="h-8 px-2 text-xs" disabled={saving} onClick={() => void saveRef.current()}>
        {saving ? "…" : "Сохранить"}
      </Button>
    ) : (
      <span className="inline-flex items-center gap-0.5">
        <Button
          type="button"
          tabIndex={-1}
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`Выше: ${line.name}`}
          title="Выше"
          disabled={ctx.busy || index === 0}
          onClick={() => ctx.run(() => moveItemsNodeAction(ctx.projectId, ctx.departmentId, "line", line.id, "up"))}
        >
          ↑
        </Button>
        <Button
          type="button"
          tabIndex={-1}
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`Ниже: ${line.name}`}
          title="Ниже"
          disabled={ctx.busy || index === count - 1}
          onClick={() => ctx.run(() => moveItemsNodeAction(ctx.projectId, ctx.departmentId, "line", line.id, "down"))}
        >
          ↓
        </Button>
        <Button
          type="button"
          tabIndex={-1}
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`В архив: ${line.name}`}
          title="В архив"
          disabled={ctx.busy}
          onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "line", line.id, true))}
        >
          <Archive className="h-4 w-4" aria-hidden />
        </Button>
      </span>
    );
  }

  return (
    <>
      <tr
        {...(isNew ? { "data-budget-new-line": subId } : { "data-budget-line": lineName })}
        ref={rowRef}
        data-line-key={key}
        data-line-sub={subId}
        data-archived={line?.archived ? "" : undefined}
        className={cn(
          "border-b border-[var(--border)]/60 align-middle",
          line?.archived && "text-[var(--muted-fg)]",
          dirty && "bg-[var(--tone-warning-bg)]/40",
          showDetails && "border-b-0",
        )}
        {...rowEvents}
      >
        <td className="sticky left-0 z-[1] bg-[var(--surface)] py-1.5 pr-2 pl-12">
          <label className="sr-only" htmlFor={`${id}-name`}>Наименование</label>
          <input
            id={`${id}-name`}
            data-field="name"
            className={cellInput}
            value={draft.name}
            disabled={!editable}
            maxLength={300}
            autoFocus={isNew}
            placeholder={isNew ? "Наименование строки, Enter — добавить" : undefined}
            onChange={(e) => update({ name: e.target.value })}
          />
        </td>
        {layout.middle.map((c) => (
          <td key={c.key} className="px-1 py-1.5">
            {control(c.key)}
          </td>
        ))}
        {shown.total == null ? (
          <td colSpan={layout.money.length} className="px-2 py-1.5 text-right text-xs text-[var(--tone-warning)]" data-line-problem>
            {problem || "—"}
          </td>
        ) : (
          <MoneyCells
            columns={layout.money}
            totals={{ amount: String(shown.amount), tax: String(shown.tax), total: String(shown.total) }}
          />
        )}
        <td className="py-1.5 pr-2 pl-1 text-right whitespace-nowrap">{actions}</td>
      </tr>
      {showDetails ? (
        // Скрытые колонки — при правке строки: под ней, в той же строке для фокуса и клавиш.
        <tr
          {...(isNew ? { "data-budget-new-line-detail": subId } : { "data-budget-line-detail": lineName })}
          className={cn("border-b border-[var(--border)]/60", dirty && "bg-[var(--tone-warning-bg)]/40")}
          {...rowEvents}
        >
          <td colSpan={layout.count} className="pt-0.5 pr-2 pb-2 pl-12">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              {hiddenEditable.map((c) => (
                <div key={c.key} style={{ width: c.width + (c.key === "multipliers" ? 24 : 16) }}>
                  <div aria-hidden className="mb-0.5 text-[11px] text-[var(--muted-fg)]">{c.label}</div>
                  {control(c.key)}
                </div>
              ))}
              {shown.total != null
                ? hiddenMoney.map((c) => (
                    <div key={c.key} className="text-sm">
                      <div className="mb-0.5 text-[11px] text-[var(--muted-fg)]">{c.label}</div>
                      <div className="flex h-8 items-center tabular-nums">
                        {formatMoney(c.key === "amount" ? String(shown.amount) : String(shown.tax))}
                      </div>
                    </div>
                  ))
                : null}
            </div>
          </td>
        </tr>
      ) : null}
      {error ? (
        <tr>
          <td colSpan={layout.count} className="px-12 pb-2 text-xs text-[var(--danger)]" role="alert">
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Поле «добавить подстатью»
// ---------------------------------------------------------------------------

function AddRow({
  label,
  placeholder,
  indent,
  colSpan,
  onAdd,
  onCancel,
}: {
  label: string;
  placeholder: string;
  indent: string;
  colSpan: number;
  onAdd: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      if (await onAdd(name)) setName("");
    } finally {
      setPending(false);
    }
  }
  return (
    <tr className="border-b border-[var(--border)]/60">
      <td colSpan={colSpan} className={cn("py-1.5 pr-2", indent)}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`add-${label}`}>{label}</label>
          <input
            id={`add-${label}`}
            autoFocus
            className={cn(cellInput, "max-w-md")}
            placeholder={placeholder}
            value={name}
            maxLength={300}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape") onCancel();
            }}
          />
          <Button type="button" className="h-8 px-3 text-xs" disabled={pending || !name.trim()} onClick={() => void submit()}>
            {pending ? "…" : "Добавить"}
          </Button>
          <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Подстатья и статья
// ---------------------------------------------------------------------------

function Chevron({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-fg)] hover:bg-[var(--nav-hover-bg)]"
      aria-expanded={open}
      aria-label={open ? `Свернуть: ${label}` : `Развернуть: ${label}`}
      onClick={onClick}
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );
}

/**
 * Строка статьи или подстатьи: название, кнопки, итоги. Кнопки — в колонках между названием и
 * деньгами; если таких колонок не выбрано — рядом с названием.
 */
function GroupRow({
  className,
  nameCellClass,
  attrs,
  name,
  buttons,
  totals,
  layout,
  strong,
}: {
  className: string;
  nameCellClass: string;
  attrs: Record<string, string>;
  name: ReactNode;
  buttons: ReactNode;
  totals: MoneyTotals;
  layout: ColumnsLayout;
  strong?: boolean;
}) {
  const inline = layout.middle.length === 0;
  return (
    <tr className={className} {...attrs}>
      <td className={nameCellClass}>
        <div className="flex min-w-0 items-center gap-1.5">
          {name}
          {inline ? <span className="ml-auto inline-flex shrink-0">{buttons}</span> : null}
        </div>
      </td>
      {inline ? null : (
        <td colSpan={layout.middle.length} className="py-1.5 pr-2 whitespace-nowrap">
          <span className="inline-flex">{buttons}</span>
        </td>
      )}
      <MoneyCells totals={totals} columns={layout.money} strong={strong} />
      <td />
    </tr>
  );
}

function SubarticleRows({
  sub,
  ctx,
  index,
  count,
  collapsed,
  toggle,
  showArchived,
}: {
  sub: TreeSubarticle;
  ctx: TableContext;
  index: number;
  count: number;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  showArchived: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sub.name);
  const open = !collapsed.has(sub.id);
  const lines = sub.lines.filter((l) => showArchived || !l.archived);
  const activeCount = sub.lines.filter((l) => !l.archived).length;
  let activeIndex = -1;

  /** Новая строка: открыть или, если уже открыта, поставить фокус в её наименование. */
  function startAdding() {
    if (adding) document.getElementById(`new-line-${sub.id}-name`)?.focus();
    else setAdding(true);
  }

  const buttons = ctx.canWrite ? (
    sub.archived ? (
      <Button
        type="button"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={ctx.busy}
        onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "subarticle", sub.id, false))}
      >
        Вернуть
      </Button>
    ) : (
      <span className="inline-flex items-center gap-0.5">
        <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={startAdding}>
          + строка
        </Button>
        <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setRenaming(true)}>
          Переименовать
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`Выше: ${sub.name}`}
          disabled={ctx.busy || index === 0}
          onClick={() => ctx.run(() => moveItemsNodeAction(ctx.projectId, ctx.departmentId, "subarticle", sub.id, "up"))}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`Ниже: ${sub.name}`}
          disabled={ctx.busy || index === count - 1}
          onClick={() => ctx.run(() => moveItemsNodeAction(ctx.projectId, ctx.departmentId, "subarticle", sub.id, "down"))}
        >
          ↓
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`В архив: ${sub.name}`}
          title="В архив"
          disabled={ctx.busy}
          onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "subarticle", sub.id, true))}
        >
          <Archive className="h-4 w-4" aria-hidden />
        </Button>
      </span>
    )
  ) : null;

  return (
    <>
      <GroupRow
        className={cn("border-b border-[var(--border)]/60 bg-[var(--surface-2)]/60", sub.archived && "text-[var(--muted-fg)]")}
        nameCellClass="sticky left-0 z-[1] bg-[var(--surface-2)] py-1.5 pr-2 pl-6"
        attrs={{ "data-budget-subarticle": sub.name }}
        layout={ctx.layout}
        totals={sub.totals}
        buttons={buttons}
        name={
          <>
            <Chevron open={open} onClick={() => toggle(sub.id)} label={sub.name} />
            {renaming ? (
              <input
                autoFocus
                aria-label="Название подстатьи"
                className={cn(cellInput, "max-w-sm")}
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    ctx.run(() => renameSubarticleAction(ctx.projectId, ctx.departmentId, sub.id, name), (r) => {
                      if (!r.error) setRenaming(false);
                    });
                  } else if (e.key === "Escape") {
                    setName(sub.name);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <span className="truncate font-medium">{sub.name}</span>
            )}
            {sub.archived ? <span className="text-xs">в архиве</span> : null}
            {sub.totals.incomplete > 0 ? (
              <span className="text-xs whitespace-nowrap text-[var(--tone-warning)]">
                {countOf(sub.totals.incomplete, ["строка", "строки", "строк"])} без суммы
              </span>
            ) : null}
          </>
        }
      />
      {open
        ? lines.map((line) => {
            if (!line.archived) activeIndex++;
            return (
              <LineRow
                key={line.id}
                line={line}
                subId={sub.id}
                ctx={ctx}
                index={line.archived ? -1 : activeIndex}
                count={activeCount}
                onEnterLast={sub.archived ? undefined : startAdding}
              />
            );
          })
        : null}
      {open && adding && !sub.archived && ctx.canWrite ? (
        <LineRow line={null} subId={sub.id} ctx={ctx} onCloseNew={() => setAdding(false)} />
      ) : null}
    </>
  );
}

function ArticleRows({
  article,
  ctx,
  collapsed,
  toggle,
  showArchived,
}: {
  article: TreeArticle;
  ctx: TableContext;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  showArchived: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const open = !collapsed.has(article.id);
  const subs = article.subarticles.filter((s) => showArchived || !s.archived);
  const activeCount = article.subarticles.filter((s) => !s.archived).length;
  let activeIndex = -1;

  const buttons = ctx.canWrite ? (
    article.archived ? (
      <Button
        type="button"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={ctx.busy}
        onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "article", article.id, false))}
      >
        Вернуть
      </Button>
    ) : (
      <span className="inline-flex items-center gap-0.5">
        <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAdding(true)}>
          + подстатья
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-1.5"
          aria-label={`В архив: ${article.name}`}
          title="В архив"
          disabled={ctx.busy}
          onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "article", article.id, true))}
        >
          <Archive className="h-4 w-4" aria-hidden />
        </Button>
      </span>
    )
  ) : null;

  return (
    <>
      <GroupRow
        className={cn("border-b border-[var(--border)] bg-[var(--surface-2)]", article.archived && "text-[var(--muted-fg)]")}
        nameCellClass="sticky left-0 z-[1] bg-[var(--surface-2)] py-2 pr-2 pl-1"
        attrs={{ "data-budget-article": article.name }}
        layout={ctx.layout}
        totals={article.totals}
        buttons={buttons}
        strong
        name={
          <>
            <Chevron open={open} onClick={() => toggle(article.id)} label={article.name} />
            <span className="truncate font-semibold">{article.name}</span>
            {article.archived ? <span className="text-xs">в архиве</span> : null}
          </>
        }
      />
      {open
        ? subs.map((sub) => {
            if (!sub.archived) activeIndex++;
            return (
              <SubarticleRows
                key={sub.id}
                sub={sub}
                ctx={ctx}
                index={sub.archived ? -1 : activeIndex}
                count={activeCount}
                collapsed={collapsed}
                toggle={toggle}
                showArchived={showArchived}
              />
            );
          })
        : null}
      {open && adding && !article.archived ? (
        <AddRow
          label={`Новая подстатья в «${article.name}»`}
          placeholder="Название подстатьи, Enter — добавить"
          indent="pl-6"
          colSpan={ctx.layout.count}
          onCancel={() => setAdding(false)}
          onAdd={(subName) =>
            new Promise((resolve) =>
              ctx.run(
                () => addSubarticleAction(ctx.projectId, ctx.departmentId, article.id, subName),
                (r) => {
                  if (!r.error) setAdding(false);
                  resolve(!r.error);
                },
              ),
            )
          }
        />
      ) : null}
      {open && subs.length === 0 && !adding ? (
        <tr className="border-b border-[var(--border)]/60">
          <td colSpan={ctx.layout.count} className="py-2 pl-12 text-xs text-[var(--muted-fg)]">
            Подстатей нет{ctx.canWrite && !article.archived ? " — добавьте «+ подстатья»" : ""}.
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Выбор колонок
// ---------------------------------------------------------------------------

function ColumnsMenu({ visible, onChange }: { visible: Set<ColumnKey>; onChange: (next: Set<ColumnKey>) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchorRef} className="inline-flex">
      <Button
        type="button"
        variant="secondary"
        className="h-8 gap-1.5 px-2.5 text-xs"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Columns3 className="h-4 w-4" aria-hidden />
        Колонки
      </Button>
      <PortaledMenu open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} role="dialog" align="end" minWidth={220}>
        <div className="space-y-0.5 p-2 text-sm" aria-label="Видимые колонки">
          <p className="px-1 pb-1 text-xs text-[var(--muted-fg)]">
            Скрытые колонки видны при правке строки — под ней.
          </p>
          {COLUMNS.map((c) => {
            const fixed = ALWAYS_COLUMNS.includes(c.key);
            return (
              <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[var(--nav-hover-bg)]">
                <input
                  type="checkbox"
                  checked={visible.has(c.key)}
                  disabled={fixed}
                  onChange={(e) => {
                    const next = new Set(visible);
                    if (e.target.checked) next.add(c.key);
                    else next.delete(c.key);
                    onChange(next);
                  }}
                />
                {c.label}
              </label>
            );
          })}
          <button
            type="button"
            className="mt-1 w-full rounded px-1 py-1 text-left text-xs text-[var(--accent)] hover:underline"
            onClick={() => onChange(new Set(DEFAULT_COLUMNS))}
          >
            Как было по умолчанию
          </button>
        </div>
      </PortaledMenu>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Таблица
// ---------------------------------------------------------------------------

/**
 * Смета цеха по статьям: статья → подстатья → строки. Итоги на каждом уровне и общий,
 * свёрнутость уровней и видимые колонки запоминаются в браузере. Кодов статей на экране нет.
 *
 * Строка сохраняется сама, когда фокус уходит из неё целиком: списки и окно множителей строки —
 * часть строки. Клавиши как в Excel: Tab — по ячейкам, Enter — сохранить и вниз (на последней
 * строке — новая строка в той же подстатье), Esc — отменить правку строки.
 */
export function BudgetItemsTable({
  projectId,
  departmentId,
  tree,
  dictionaries,
  canWrite,
  dirtyRows,
  onRevision,
}: {
  projectId: string;
  departmentId: string;
  tree: DepartmentItemsTree;
  dictionaries: ItemsDictionaries;
  canWrite: boolean;
  dirtyRows: DirtyRows;
  onRevision: (revision: number) => void;
}) {
  const router = useRouter();
  const [collapsed, toggle] = useCollapsedIds(`smeta-items-collapsed:${tree.budgetId}`);
  const [storedColumns, storeColumns] = useStoredString(COLUMNS_KEY);
  const visible = useMemo(() => parseVisibleColumns(storedColumns), [storedColumns]);
  const layout = useMemo(() => layoutOf(visible), [visible]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [template, setTemplate] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [marks] = useState(() => new WeakMap<Event, string>());
  const [leaves] = useState(() => new Map<string, () => void>());
  const tableRef = useRef<HTMLTableElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const unsaved = useUnsavedChanges();

  // Несохранённые строки — в общем механизме: вопрос при уходе со страницы.
  useEffect(
    () =>
      unsaved.register(
        () => dirtyRows.size > 0,
        async () => {
          for (const save of [...dirtyRows.values()]) if (!(await save())) return false;
          return true;
        },
      ),
    [unsaved, dirtyRows],
  );

  // Какая строка сейчас «в работе» и когда фокус ушёл из неё целиком. События строки (в том числе
  // из её выпадающих списков и окна множителей, которые рисуются поверх страницы) строка помечает
  // сама; здесь, на уровне окна, видно, чья это строка. Пока кнопка мыши нажата, переход ждёт её
  // отпускания: иначе строка под курсором сдвинется до щелчка.
  useEffect(() => {
    let active: string | null = null;
    let pointerDown = false;
    const pending: (() => void)[] = [];
    const later = (fn: () => void) => (pointerDown ? pending.push(fn) : fn());
    const release = () => {
      if (!pointerDown) return;
      pointerDown = false;
      window.setTimeout(() => pending.splice(0).forEach((fn) => fn()), 0);
    };
    const transition = (next: string | null) => {
      if (next === active) return;
      const prev = active;
      active = next;
      later(() => {
        setActiveKey(active);
        // В строку уже вернулись (щелчок по «+ строка» ставит фокус в новую строку) — ухода нет.
        // Ушли со страницы по ссылке — правку решает вопрос «Сохранить / Не сохранять».
        if (prev && prev !== active && !unsaved.isPrompting()) leaves.get(prev)?.();
      });
    };
    const onPointerDownCapture = () => {
      pointerDown = true;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (active === null || marks.get(event) === active) return;
      // Нажали мимо строки: если фокус никуда не перешёл (пустое место) — строку покинули.
      later(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body) transition(null);
      });
    };
    const onFocusIn = (event: FocusEvent) => transition(marks.get(event) ?? null);
    window.addEventListener("pointerdown", onPointerDownCapture, true);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, [marks, leaves, unsaved]);

  const variables: VariableOption[] = useMemo(
    () => tree.variables.map((v) => ({ id: v.id, label: v.label, value: v.value })),
    [tree.variables],
  );
  const variableValues = useMemo(() => new Map(tree.variables.map((v) => [v.id, v.value])), [tree.variables]);

  function run(call: () => Promise<ItemsActionState>, after?: (r: ItemsActionState) => void) {
    setBusy(true);
    startTransition(async () => {
      try {
        const result = await call();
        if (result.error) toast.error(result.error);
        else {
          if (result.revision) onRevision(result.revision);
          router.refresh();
        }
        after?.(result);
      } catch {
        toast.error("Нет связи с сервером");
        after?.({ error: "Нет связи с сервером" });
      } finally {
        setBusy(false);
      }
    });
  }

  function focusNext(key: string, subId: string, field: string): boolean {
    const rows = [
      ...(tableRef.current?.querySelectorAll<HTMLTableRowElement>(`tr[data-line-sub="${subId}"]:not([data-archived])`) ?? []),
    ];
    const next = rows[rows.findIndex((r) => r.dataset.lineKey === key) + 1];
    if (!next) return false;
    const target =
      (next.dataset.budgetNewLine === undefined ? next.querySelector<HTMLInputElement>(`input[data-field="${field}"]`) : null) ??
      next.querySelector<HTMLInputElement>('input[data-field="name"]');
    target?.focus();
    target?.select();
    return true;
  }

  const ctx: TableContext = {
    projectId,
    departmentId,
    canWrite,
    variables,
    variableValues,
    dictionaries,
    dirtyRows,
    onRevision,
    run,
    busy,
    layout,
    activeKey,
    mark: (event, key) => {
      if (!marks.has(event)) marks.set(event, key);
    },
    leaves,
    focusNext,
    enqueue: (task) => {
      queue.current = queue.current.then(task, task);
    },
  };
  const articles = tree.articles.filter((a) => showArchived || !a.archived);
  const hasArchived =
    tree.articles.some((a) => a.archived || a.subarticles.some((s) => s.archived || s.lines.some((l) => l.archived)));
  const minWidth = NAME_MIN_WIDTH + ACTIONS_WIDTH + [...layout.middle, ...layout.money].reduce((sum, c) => sum + c.width, 0);

  let body: ReactNode;
  if (articles.length === 0) {
    body = (
      <tr>
        <td colSpan={layout.count} className="px-4 py-8 text-center text-sm text-[var(--muted-fg)]">
          {canWrite
            ? "В смете пока нет статей. Возьмите статью из шаблона фильма."
            : "В смете пока нет статей."}
        </td>
      </tr>
    );
  } else {
    body = articles.map((article) => (
      <ArticleRows
        key={article.id}
        article={article}
        ctx={ctx}
        collapsed={collapsed}
        toggle={toggle}
        showArchived={showArchived}
      />
    ));
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="take-template-trigger">Статья из шаблона</label>
            <div className="w-64 max-w-full">
              <Select id="take-template" className="h-8" value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Статья из шаблона…</option>
                {dictionaries.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              className="h-8"
              disabled={!template || busy}
              onClick={() =>
                run(() => takeTemplateArticleAction(projectId, departmentId, template), (r) => {
                  if (!r.error) setTemplate("");
                })
              }
            >
              Взять статью
            </Button>
            <BudgetItemsImport
              projectId={projectId}
              departmentId={departmentId}
              articles={tree.articles
                .filter((a) => !a.archived)
                .map((a) => ({
                  id: a.id,
                  name: a.name,
                  subarticles: a.subarticles.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name })),
                }))}
              beforeImport={async () => {
                for (const save of [...dirtyRows.values()]) if (!(await save())) return false;
                return true;
              }}
              onRevision={onRevision}
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted-fg)]">
          {hasArchived ? (
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Показать архив
            </label>
          ) : null}
          <ColumnsMenu visible={visible} onChange={(next) => storeColumns(COLUMNS.filter((c) => next.has(c.key)).map((c) => c.key).join(","))} />
        </div>
      </div>
      <datalist id="budget-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full table-fixed text-sm" style={{ minWidth }} aria-label="Смета цеха">
          <colgroup>
            <col />
            {[...layout.middle, ...layout.money].map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: ACTIONS_WIDTH }} />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="sticky left-0 z-[1] bg-[var(--glass-table-head)] py-2 pr-2 pl-12 font-semibold">Наименование</th>
              {[...layout.middle, ...layout.money].map((c) => (
                <th key={c.key} className={cn(c.money ? "px-2" : "px-1", "py-2", c.right && "text-right")}>
                  {c.label}
                </th>
              ))}
              <th className="py-2 pr-2 pl-1" />
            </tr>
          </thead>
          <tbody>{body}</tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]">
              <td className="sticky left-0 z-[1] bg-[var(--surface-2)] py-2.5 pr-2 pl-3 font-semibold">
                Итого по смете
                {tree.totals.incomplete > 0 ? (
                  <span className="ml-2 text-xs font-normal text-[var(--tone-warning)]">
                    {countOf(tree.totals.incomplete, ["строка", "строки", "строк"])} без суммы — не вошли в итог
                  </span>
                ) : null}
              </td>
              {layout.middle.length > 0 ? <td colSpan={layout.middle.length} /> : null}
              <MoneyCells totals={tree.totals} columns={layout.money} strong />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
