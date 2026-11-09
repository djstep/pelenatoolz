"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
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
import { BudgetMultipliersModal, multipliersText, type VariableOption } from "@/features/smeta/components/budget-multipliers-modal";
import { useCollapsedIds } from "@/features/smeta/components/use-collapsed-ids";
import type { ItemProblem } from "@/features/smeta/lib/item-calc";
import {
  draftFromLine,
  draftToPayload,
  formatMoney,
  previewDraft,
  sameDraft,
  type DraftSlot,
  type LineDraft,
} from "@/features/smeta/lib/line-draft";
import { useOnChange } from "@/shared/hooks/use-on-change";
import { cn } from "@/shared/lib/cn";
import { countOf } from "@/shared/lib/plural";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";

/** Единицы — подсказки поля; можно вписать свою. */
const UNITS = ["смена", "день", "неделя", "месяц", "час", "шт.", "км", "серия", "комплект", "услуга"];

/** Несохранённые строки таблицы: id → сохранить (true — сохранилось). */
export type DirtyRows = Map<string, () => Promise<boolean>>;

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
};

const cellInput =
  "h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-70";
const numberInput = `${cellInput} text-right tabular-nums`;
const moneyCell = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

function MoneyCells({ totals, strong }: { totals: Pick<MoneyTotals, "amount" | "tax" | "total">; strong?: boolean }) {
  return (
    <>
      <td className={moneyCell}>{formatMoney(totals.amount)}</td>
      <td className={moneyCell}>{formatMoney(totals.tax)}</td>
      <td className={cn(moneyCell, strong && "font-semibold")}>{formatMoney(totals.total)}</td>
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
// Строка
// ---------------------------------------------------------------------------

function LineRow({ line, ctx, index, count }: { line: TreeLine; ctx: TableContext; index: number; count: number }) {
  const router = useRouter();
  const initial = useMemo(() => draftFromLine(line), [line]);
  const [draft, setDraft] = useState<LineDraft>(initial);
  /** Строка с сервера, от которой идут правки. */
  const [base, setBase] = useState<LineDraft>(initial);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [multipliersOpen, setMultipliersOpen] = useState(false);
  // С сервера пришла строка (сохранили или обновили страницу): если в строке нет своих правок
  // или их только что сохранили — показать её; набранное, но не сохранённое не трогаем.
  useOnChange([initial], () => {
    setBase(initial);
    if (justSaved || sameDraft(draft, base)) setDraft(initial);
    if (justSaved) setJustSaved(false);
  });
  const dirty = !sameDraft(draft, base);
  const editable = ctx.canWrite && !line.archived;
  const preview = useMemo(() => previewDraft(draft, ctx.variableValues), [draft, ctx.variableValues]);
  const shown = dirty ? preview : { amount: line.amount, tax: line.tax, total: line.total, problems: line.problems, invalid: [] };

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    if (preview.invalid.length > 0) {
      setError("Проверьте числа: количество, ставка, налог и множители — числа от 0");
      return false;
    }
    if (!draft.name.trim()) {
      setError("Введите наименование");
      return false;
    }
    setSaving(true);
    try {
      const result = await updateLineAction(ctx.projectId, ctx.departmentId, line.id, draftToPayload(draft));
      if (result.error) {
        setError(result.error);
        return false;
      }
      setError(null);
      if (result.revision) ctx.onRevision(result.revision);
      setJustSaved(true);
      router.refresh();
      return true;
    } catch {
      setError("Нет связи с сервером — строка не сохранена");
      return false;
    } finally {
      setSaving(false);
    }
  }
  // Для общего механизма несохранённых правок — всегда свежая версия сохранения.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  // Несохранённая строка — в общем механизме несохранённых правок страницы.
  const { dirtyRows } = ctx;
  useEffect(() => {
    if (!dirty) return;
    const save = () => saveRef.current();
    dirtyRows.set(line.id, save);
    return () => {
      dirtyRows.delete(line.id);
    };
  }, [dirty, dirtyRows, line.id]);

  function update(patch: Partial<LineDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void saveRef.current();
    } else if (event.key === "Escape" && dirty) {
      setDraft(base);
      setError(null);
    }
  }

  const forms = ctx.dictionaries.paymentForms.filter((f) => !f.archived || f.id === draft.paymentFormId);
  const types = ctx.dictionaries.expenseTypes.filter((t) => !t.archived || t.id === draft.expenseTypeId);
  const id = `line-${line.id}`;
  const problem = shown.total == null ? problemText(shown.problems, ctx.variables) : "";

  return (
    <>
      <tr
        data-budget-line={line.name}
        className={cn("border-b border-[var(--border)]/60 align-middle", line.archived && "text-[var(--muted-fg)]", dirty && "bg-[var(--tone-warning-bg)]/40")}
        onKeyDown={onKeyDown}
      >
        <td className="sticky left-0 z-[1] bg-[var(--surface)] py-1.5 pr-2 pl-12">
          <label className="sr-only" htmlFor={`${id}-name`}>Наименование</label>
          <input
            id={`${id}-name`}
            className={cellInput}
            value={draft.name}
            disabled={!editable}
            maxLength={300}
            onChange={(e) => update({ name: e.target.value })}
          />
        </td>
        <td className="px-1 py-1.5">
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
        </td>
        <td className="px-1 py-1.5">
          <label className="sr-only" htmlFor={`${id}-unit`}>Единица</label>
          <input
            id={`${id}-unit`}
            className={cellInput}
            list="budget-units"
            value={draft.unit}
            disabled={!editable}
            maxLength={40}
            onChange={(e) => update({ unit: e.target.value })}
          />
        </td>
        <td className="px-1 py-1.5">
          <label className="sr-only" htmlFor={`${id}-quantity`}>Количество</label>
          <input
            id={`${id}-quantity`}
            className={cn(numberInput, preview.invalid.includes("quantity") && "border-[var(--danger)]")}
            inputMode="decimal"
            value={draft.quantity}
            disabled={!editable}
            onChange={(e) => update({ quantity: e.target.value })}
          />
        </td>
        <td className="px-1 py-1.5">
          <label className="sr-only" htmlFor={`${id}-rate`}>Ставка</label>
          <input
            id={`${id}-rate`}
            className={cn(numberInput, preview.invalid.includes("rate") && "border-[var(--danger)]")}
            inputMode="decimal"
            value={draft.rate}
            disabled={!editable}
            onChange={(e) => update({ rate: e.target.value })}
          />
        </td>
        <td className="px-1 py-1.5">
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
        </td>
        <td className="px-1 py-1.5">
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
        </td>
        <td className="px-1 py-1.5">
          <label className="sr-only" htmlFor={`${id}-tax`}>Налог, %</label>
          <input
            id={`${id}-tax`}
            className={cn(numberInput, preview.invalid.includes("taxPercent") && "border-[var(--danger)]")}
            inputMode="decimal"
            value={draft.taxPercent}
            disabled={!editable}
            onChange={(e) => update({ taxPercent: e.target.value })}
          />
        </td>
        {shown.total == null ? (
          <td colSpan={3} className="px-2 py-1.5 text-right text-xs text-[var(--tone-warning)]" data-line-problem>
            {problem || "—"}
          </td>
        ) : (
          <MoneyCells totals={{ amount: String(shown.amount), tax: String(shown.tax), total: String(shown.total) }} />
        )}
        <td className="py-1.5 pr-2 pl-1 text-right whitespace-nowrap">
          {ctx.canWrite ? (
            line.archived ? (
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2 text-xs"
                disabled={ctx.busy}
                onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "line", line.id, false))}
              >
                Вернуть
              </Button>
            ) : (
              <span className="inline-flex items-center gap-0.5">
                {dirty ? (
                  <Button type="button" className="h-8 px-2 text-xs" disabled={saving} onClick={() => void saveRef.current()}>
                    {saving ? "…" : "Сохранить"}
                  </Button>
                ) : null}
                <Button
                  type="button"
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
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  aria-label={`В архив: ${line.name}`}
                  disabled={ctx.busy}
                  onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "line", line.id, true))}
                >
                  В архив
                </Button>
              </span>
            )
          ) : null}
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={12} className="px-12 pb-2 text-xs text-[var(--danger)]" role="alert">
            {error}
          </td>
        </tr>
      ) : null}
      {multipliersOpen ? (
        <BudgetMultipliersModal
          open
          slots={draft.slots}
          variables={ctx.variables}
          onClose={() => setMultipliersOpen(false)}
          onApply={(slots: [DraftSlot, DraftSlot, DraftSlot]) => update({ slots })}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Поле «добавить» (подстатья, строка)
// ---------------------------------------------------------------------------

function AddRow({
  label,
  placeholder,
  indent,
  onAdd,
  onCancel,
}: {
  label: string;
  placeholder: string;
  indent: string;
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
      <td colSpan={12} className={cn("py-1.5 pr-2", indent)}>
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

  return (
    <>
      <tr
        className={cn("border-b border-[var(--border)]/60 bg-[var(--surface-2)]/60", sub.archived && "text-[var(--muted-fg)]")}
        data-budget-subarticle={sub.name}
      >
        <td className="sticky left-0 z-[1] bg-[var(--surface-2)] py-1.5 pr-2 pl-6">
          <div className="flex min-w-0 items-center gap-1.5">
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
              <span className="text-xs text-[var(--tone-warning)]">
                {countOf(sub.totals.incomplete, ["строка", "строки", "строк"])} без суммы
              </span>
            ) : null}
          </div>
        </td>
        <td colSpan={7} className="py-1.5 pr-2 whitespace-nowrap">
            <span className="inline-flex">
          {ctx.canWrite ? (
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
                <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAdding(true)}>
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
                  className="h-8 px-2 text-xs"
                  aria-label={`В архив: ${sub.name}`}
                  disabled={ctx.busy}
                  onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "subarticle", sub.id, true))}
                >
                  В архив
                </Button>
              </span>
            )
          ) : null}
            </span>
        </td>
        <MoneyCells totals={sub.totals} />
        <td />
      </tr>
      {open
        ? lines.map((line) => {
            if (!line.archived) activeIndex++;
            return <LineRow key={line.id} line={line} ctx={ctx} index={line.archived ? -1 : activeIndex} count={activeCount} />;
          })
        : null}
      {open && adding && !sub.archived ? (
        <AddRow
          label={`Новая строка в «${sub.name}»`}
          placeholder="Наименование строки, Enter — добавить"
          indent="pl-12"
          onCancel={() => setAdding(false)}
          onAdd={(lineName) =>
            new Promise((resolve) =>
              ctx.run(
                () => addLineAction(ctx.projectId, ctx.departmentId, sub.id, { name: lineName }),
                (r) => resolve(!r.error),
              ),
            )
          }
        />
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

  return (
    <>
      <tr
        className={cn("border-b border-[var(--border)] bg-[var(--surface-2)]", article.archived && "text-[var(--muted-fg)]")}
        data-budget-article={article.name}
      >
        <td className="sticky left-0 z-[1] bg-[var(--surface-2)] py-2 pr-2 pl-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Chevron open={open} onClick={() => toggle(article.id)} label={article.name} />
            <span className="truncate font-semibold">{article.name}</span>
            {article.archived ? <span className="text-xs">в архиве</span> : null}
          </div>
        </td>
        <td colSpan={7} className="py-1.5 pr-2 whitespace-nowrap">
            <span className="inline-flex">
          {ctx.canWrite ? (
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
                  className="h-8 px-2 text-xs"
                  aria-label={`В архив: ${article.name}`}
                  disabled={ctx.busy}
                  onClick={() => ctx.run(() => setItemsNodeArchivedAction(ctx.projectId, ctx.departmentId, "article", article.id, true))}
                >
                  В архив
                </Button>
              </span>
            )
          ) : null}
            </span>
        </td>
        <MoneyCells totals={article.totals} strong />
        <td />
      </tr>
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
          <td colSpan={12} className="py-2 pl-12 text-xs text-[var(--muted-fg)]">
            Подстатей нет{ctx.canWrite && !article.archived ? " — добавьте «+ подстатья»" : ""}.
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Таблица
// ---------------------------------------------------------------------------

/**
 * Смета цеха по статьям: статья → подстатья → строки. Итоги на каждом уровне и общий,
 * свёрнутость уровней запоминается в браузере. Кодов статей на экране нет.
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
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [template, setTemplate] = useState("");
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
  };
  const articles = tree.articles.filter((a) => showArchived || !a.archived);
  const hasArchived =
    tree.articles.some((a) => a.archived || a.subarticles.some((s) => s.archived || s.lines.some((l) => l.archived)));

  let body: ReactNode;
  if (articles.length === 0) {
    body = (
      <tr>
        <td colSpan={12} className="px-4 py-8 text-center text-sm text-[var(--muted-fg)]">
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
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted-fg)]">
          {hasArchived ? (
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Показать архив
            </label>
          ) : null}
        </div>
      </div>
      <datalist id="budget-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1560px] table-fixed text-sm" aria-label="Смета цеха">
          <colgroup>
            <col className="w-[300px]" />
            <col className="w-[150px]" />
            <col className="w-[96px]" />
            <col className="w-[84px]" />
            <col className="w-[116px]" />
            <col className="w-[200px]" />
            <col className="w-[136px]" />
            <col className="w-[76px]" />
            <col className="w-[118px]" />
            <col className="w-[104px]" />
            <col className="w-[124px]" />
            <col className="w-[160px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="sticky left-0 z-[1] bg-[var(--glass-table-head)] py-2 pr-2 pl-12 font-semibold">Наименование</th>
              <th className="px-1 py-2">Тип</th>
              <th className="px-1 py-2">Ед.</th>
              <th className="px-1 py-2 text-right">Кол-во</th>
              <th className="px-1 py-2 text-right">Ставка</th>
              <th className="px-1 py-2">Множители</th>
              <th className="px-1 py-2">Форма оплаты</th>
              <th className="px-1 py-2 text-right">Налог, %</th>
              <th className="px-2 py-2 text-right">Сумма</th>
              <th className="px-2 py-2 text-right">Налог</th>
              <th className="px-2 py-2 text-right">Итого</th>
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
              <td colSpan={7} />
              <MoneyCells totals={tree.totals} strong />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
