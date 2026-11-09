"use server";

import { Prisma, type CounterpartyType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COUNTERPARTY_TYPES, counterpartyTypeLabels } from "@/features/counterparties/labels";
import { formatPercent, parseOptionalPercent, parseRequiredPercent } from "@/features/finance/lib/percent";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canEditBudgetDictionaries } from "@/features/smeta/lib/smeta-access";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/**
 * Справочники сметы в «Финансы → Настройки»: типы расходов, формы оплаты с процентом налога,
 * сопоставление «тип контрагента → форма оплаты», резерв и агентские сводной.
 * Меняют продюсер и роль с «Финансы: правка»; главы цехов только видят.
 */

export type DictionaryActionState = { error?: string; success?: string };

const NO_RIGHTS = "Справочники сметы меняют продюсер и роль с правом «Финансы: правка»";
const NOT_FOUND = "Запись не найдена";

const nameSchema = z.string().trim().min(1, "Введите название").max(80, "Слишком длинное название");

function revalidate(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/finance/settings`);
  revalidatePath(`/ru/projects/${projectId}/smeta`, "layout");
  revalidatePath(`/ru/projects/${projectId}/counterparties`, "layout");
}

async function editorContext(projectId: string) {
  const ctx = await requireProjectContext(projectId);
  return canEditBudgetDictionaries(ctx) ? ctx : null;
}

/** Id из браузера — строка разумной длины; иное — подделка, отказ без обращения к базе. */
function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * Запись с проверкой уникального названия: при одновременных запросах проверка «имя занято»
 * может пропустить дубль — тогда база отказывает (P2002), и вернётся понятный текст, а не сбой.
 */
async function withUniqueName(run: () => Promise<unknown>, message: string): Promise<DictionaryActionState | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: message };
    }
    throw error;
  }
}

function parseName(formData: FormData) {
  const parsed = nameSchema.safeParse(formData.get("name"));
  return parsed.success
    ? ({ ok: true, name: parsed.data } as const)
    : ({ ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте название" } as const);
}

// ---------------------------------------------------------------------------
// Типы расходов
// ---------------------------------------------------------------------------

async function expenseNameTaken(projectId: string, name: string, exceptId?: string) {
  const found = await prisma.projectExpenseType.findFirst({
    where: {
      projectId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

export async function createExpenseTypeAction(
  projectId: string,
  _prev: DictionaryActionState,
  formData: FormData,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  const parsed = parseName(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (await expenseNameTaken(projectId, parsed.name)) return { error: "Такой тип расхода уже есть" };

  const duplicate = await withUniqueName(() => prisma.$transaction(async (tx) => {
    const last = await tx.projectExpenseType.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    await auditMutation(
      ctx,
      () =>
        tx.projectExpenseType.create({
          data: { projectId, name: parsed.name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
          select: { id: true },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.expenseType,
        action: "CREATE",
        entityId: (_input, row) => row.id,
        summary: `Добавлен тип расхода «${parsed.name}»`,
      },
      { db: tx },
    );
  }), "Такой тип расхода уже есть");
  if (duplicate) return duplicate;

  revalidate(projectId);
  return { success: "Тип расхода добавлен" };
}

export async function renameExpenseTypeAction(
  projectId: string,
  typeId: string,
  _prev: DictionaryActionState,
  formData: FormData,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(typeId)) return { error: NOT_FOUND };
  const existing = await prisma.projectExpenseType.findFirst({
    where: { id: typeId, projectId },
    select: { name: true },
  });
  if (!existing) return { error: NOT_FOUND };
  const parsed = parseName(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.name === existing.name) return { success: "Сохранено" };
  if (await expenseNameTaken(projectId, parsed.name, typeId)) return { error: "Такой тип расхода уже есть" };

  const duplicate = await withUniqueName(() => prisma.$transaction((tx) =>
    auditMutation(
      ctx,
      () => tx.projectExpenseType.update({ where: { id: typeId }, data: { name: parsed.name } }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.expenseType,
        action: "UPDATE",
        entityId: typeId,
        summary: `Тип расхода «${existing.name}» переименован в «${parsed.name}»`,
        changes: { name: [existing.name, parsed.name] },
      },
      { db: tx },
    ),
  ), "Такой тип расхода уже есть");
  if (duplicate) return duplicate;

  revalidate(projectId);
  return { success: "Сохранено" };
}

/** В архив или обратно. Тип не удаляется: на него ссылаются строки смет. */
export async function setExpenseTypeArchivedAction(
  projectId: string,
  typeId: string,
  archived: boolean,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(typeId) || typeof archived !== "boolean") return { error: NOT_FOUND };
  const existing = await prisma.projectExpenseType.findFirst({
    where: { id: typeId, projectId },
    select: { name: true, archivedAt: true },
  });
  if (!existing) return { error: NOT_FOUND };
  if ((existing.archivedAt !== null) === Boolean(archived)) return { success: "Без изменений" };

  await prisma.$transaction((tx) =>
    auditMutation(
      ctx,
      () =>
        tx.projectExpenseType.update({
          where: { id: typeId },
          data: { archivedAt: archived ? new Date() : null },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.expenseType,
        action: "UPDATE",
        entityId: typeId,
        summary: archived
          ? `Тип расхода «${existing.name}» убран в архив`
          : `Тип расхода «${existing.name}» возвращён из архива`,
      },
      { db: tx },
    ),
  );

  revalidate(projectId);
  return { success: archived ? "Тип в архиве" : "Тип возвращён" };
}

// ---------------------------------------------------------------------------
// Формы оплаты
// ---------------------------------------------------------------------------

async function formNameTaken(projectId: string, name: string, exceptId?: string) {
  const found = await prisma.projectPaymentForm.findFirst({
    where: {
      projectId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

const PERCENT_ERROR = "Процент налога — число от 0 до 100 или пусто";

export async function createPaymentFormAction(
  projectId: string,
  _prev: DictionaryActionState,
  formData: FormData,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  const parsed = parseName(formData);
  if (!parsed.ok) return { error: parsed.error };
  const percent = parseOptionalPercent(formData.get("defaultTaxPercent"));
  if (!percent.ok) return { error: PERCENT_ERROR };
  if (await formNameTaken(projectId, parsed.name)) return { error: "Такая форма оплаты уже есть" };

  const duplicate = await withUniqueName(() => prisma.$transaction(async (tx) => {
    const last = await tx.projectPaymentForm.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    await auditMutation(
      ctx,
      () =>
        tx.projectPaymentForm.create({
          data: {
            projectId,
            name: parsed.name,
            defaultTaxPercent: percent.value,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
          select: { id: true },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.paymentForm,
        action: "CREATE",
        entityId: (_input, row) => row.id,
        summary: `Добавлена форма оплаты «${parsed.name}», налог ${formatPercent(percent.value)}`,
      },
      { db: tx },
    );
  }), "Такая форма оплаты уже есть");
  if (duplicate) return duplicate;

  revalidate(projectId);
  return { success: "Форма оплаты добавлена" };
}

export async function updatePaymentFormAction(
  projectId: string,
  formId: string,
  _prev: DictionaryActionState,
  formData: FormData,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(formId)) return { error: NOT_FOUND };
  const existing = await prisma.projectPaymentForm.findFirst({
    where: { id: formId, projectId },
    select: { name: true, defaultTaxPercent: true },
  });
  if (!existing) return { error: NOT_FOUND };
  const parsed = parseName(formData);
  if (!parsed.ok) return { error: parsed.error };
  const percent = parseOptionalPercent(formData.get("defaultTaxPercent"));
  if (!percent.ok) return { error: PERCENT_ERROR };
  const before = existing.defaultTaxPercent == null ? null : Number(existing.defaultTaxPercent);
  if (parsed.name === existing.name && before === percent.value) return { success: "Сохранено" };
  if (await formNameTaken(projectId, parsed.name, formId)) return { error: "Такая форма оплаты уже есть" };

  const changes: Record<string, unknown> = {};
  if (parsed.name !== existing.name) changes.name = [existing.name, parsed.name];
  if (before !== percent.value) changes.defaultTaxPercent = [before, percent.value];

  const duplicate = await withUniqueName(() => prisma.$transaction((tx) =>
    auditMutation(
      ctx,
      () =>
        tx.projectPaymentForm.update({
          where: { id: formId },
          data: { name: parsed.name, defaultTaxPercent: percent.value },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.paymentForm,
        action: "UPDATE",
        entityId: formId,
        summary:
          before !== percent.value
            ? `Форма оплаты «${parsed.name}»: налог ${formatPercent(before)} → ${formatPercent(percent.value)}`
            : `Форма оплаты «${existing.name}» переименована в «${parsed.name}»`,
        changes,
      },
      { db: tx },
    ),
  ), "Такая форма оплаты уже есть");
  if (duplicate) return duplicate;

  revalidate(projectId);
  return { success: "Сохранено" };
}

/**
 * В архив или обратно. Форма не удаляется: на неё ссылаются строки смет. Уходя в архив,
 * форма перестаёт быть налогом по умолчанию для типов контрагентов — сопоставление снимается.
 */
export async function setPaymentFormArchivedAction(
  projectId: string,
  formId: string,
  archived: boolean,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(formId) || typeof archived !== "boolean") return { error: NOT_FOUND };
  const existing = await prisma.projectPaymentForm.findFirst({
    where: { id: formId, projectId },
    select: { name: true, archivedAt: true },
  });
  if (!existing) return { error: NOT_FOUND };
  if ((existing.archivedAt !== null) === Boolean(archived)) return { success: "Без изменений" };

  await prisma.$transaction(async (tx) => {
    // Сначала сама форма: строка блокируется, параллельное сопоставление дождётся и увидит архив.
    await tx.projectPaymentForm.update({
      where: { id: formId },
      data: { archivedAt: archived ? new Date() : null },
    });
    const unmapped = archived
      ? await tx.projectCounterpartyPaymentForm.findMany({
          where: { projectId, paymentFormId: formId },
          select: { counterpartyType: true },
        })
      : [];
    await auditMutation(
      ctx,
      async () => {
        if (unmapped.length > 0) {
          await tx.projectCounterpartyPaymentForm.deleteMany({ where: { projectId, paymentFormId: formId } });
        }
      },
      undefined,
      {
        projectId,
        entityType: AuditEntityType.paymentForm,
        action: "UPDATE",
        entityId: formId,
        summary: archived
          ? `Форма оплаты «${existing.name}» убрана в архив` +
            (unmapped.length > 0
              ? `; снято сопоставление: ${unmapped.map((m) => counterpartyTypeLabels[m.counterpartyType]).join(", ")}`
              : "")
          : `Форма оплаты «${existing.name}» возвращена из архива`,
      },
      { db: tx },
    );
  });

  revalidate(projectId);
  return { success: archived ? "Форма в архиве" : "Форма возвращена" };
}

// ---------------------------------------------------------------------------
// Тип контрагента → форма оплаты
// ---------------------------------------------------------------------------

/** Поля формы: по одному на тип контрагента, значение — id формы оплаты или пусто. */
export async function saveCounterpartyPaymentFormsAction(
  projectId: string,
  _prev: DictionaryActionState,
  formData: FormData,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };

  const wanted = new Map<CounterpartyType, string | null>();
  for (const type of COUNTERPARTY_TYPES) {
    const raw = formData.get(`map-${type}`);
    wanted.set(type, typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null);
  }
  const formIds = [...new Set([...wanted.values()].filter((v): v is string => v !== null))];
  try {
    await assertInProject("ProjectPaymentForm", formIds, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Форма оплаты не найдена" };
    throw error;
  }
  const forms = await prisma.projectPaymentForm.findMany({
    where: { projectId, id: { in: formIds } },
    select: { id: true, name: true, archivedAt: true },
  });
  const ARCHIVED = "Форма оплаты в архиве — выберите другую";
  if (forms.some((f) => f.archivedAt !== null)) return { error: ARCHIVED };
  const formName = new Map(forms.map((f) => [f.id, f.name]));

  const result = await prisma.$transaction(async (tx) => {
    // Формы блокируются от перевода в архив до конца записи и проверяются ещё раз.
    if (formIds.length > 0) {
      const locked = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
        SELECT "archivedAt" FROM "ProjectPaymentForm"
        WHERE "projectId" = ${projectId} AND "id" = ANY(${formIds}) FOR SHARE`;
      if (locked.length < formIds.length || locked.some((f) => f.archivedAt !== null)) {
        return { archived: true, changed: 0 };
      }
    }
    const current = await tx.projectCounterpartyPaymentForm.findMany({
      where: { projectId },
      select: { counterpartyType: true, paymentFormId: true, paymentForm: { select: { name: true } } },
    });
    const before = new Map(current.map((c) => [c.counterpartyType, c]));
    const changed = COUNTERPARTY_TYPES.filter(
      (type) => (before.get(type)?.paymentFormId ?? null) !== wanted.get(type),
    );
    if (changed.length === 0) return { archived: false, changed: 0 };

    const describe = changed.map((type) => {
      const was = before.get(type)?.paymentForm.name ?? "—";
      const next = wanted.get(type);
      return `${counterpartyTypeLabels[type]}: ${was} → ${next ? formName.get(next) : "—"}`;
    });
    await auditMutation(
      ctx,
      async () => {
        for (const type of changed) {
          const paymentFormId = wanted.get(type);
          if (paymentFormId) {
            await tx.projectCounterpartyPaymentForm.upsert({
              where: { projectId_counterpartyType: { projectId, counterpartyType: type } },
              create: { projectId, counterpartyType: type, paymentFormId },
              update: { paymentFormId },
            });
          } else {
            await tx.projectCounterpartyPaymentForm.deleteMany({ where: { projectId, counterpartyType: type } });
          }
        }
      },
      undefined,
      {
        projectId,
        entityType: AuditEntityType.counterpartyPaymentForm,
        action: "UPDATE",
        entityId: projectId,
        summary: `Налог по типу контрагента: ${describe.join("; ")}`,
      },
      { db: tx },
    );
    return { archived: false, changed: changed.length };
  });
  if (result.archived) return { error: ARCHIVED };

  revalidate(projectId);
  return { success: result.changed > 0 ? "Сохранено" : "Без изменений" };
}

// ---------------------------------------------------------------------------
// Резерв и агентские сводной
// ---------------------------------------------------------------------------

export async function saveBudgetPercentsAction(
  projectId: string,
  _prev: DictionaryActionState,
  formData: FormData,
): Promise<DictionaryActionState> {
  const ctx = await editorContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  const reserve = parseRequiredPercent(formData.get("reservePercent"));
  const agency = parseRequiredPercent(formData.get("agencyPercent"));
  if (!reserve.ok || !agency.ok) return { error: "Проценты — числа от 0 до 100" };

  const changed = await prisma.$transaction(async (tx) => {
    const current = await tx.projectBudgetSettings.findUnique({
      where: { projectId },
      select: { reservePercent: true, agencyPercent: true },
    });
    const was = {
      reserve: current ? Number(current.reservePercent) : 0,
      agency: current ? Number(current.agencyPercent) : 0,
    };
    if (was.reserve === reserve.value && was.agency === agency.value) return false;

    const parts: string[] = [];
    const changes: Record<string, unknown> = {};
    if (was.reserve !== reserve.value) {
      parts.push(`резерв ${formatPercent(was.reserve)} → ${formatPercent(reserve.value)}`);
      changes.reservePercent = [was.reserve, reserve.value];
    }
    if (was.agency !== agency.value) {
      parts.push(`агентские ${formatPercent(was.agency)} → ${formatPercent(agency.value)}`);
      changes.agencyPercent = [was.agency, agency.value];
    }
    await auditMutation(
      ctx,
      () =>
        tx.projectBudgetSettings.upsert({
          where: { projectId },
          create: { projectId, reservePercent: reserve.value, agencyPercent: agency.value },
          update: { reservePercent: reserve.value, agencyPercent: agency.value },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budgetSettings,
        action: "UPDATE",
        entityId: projectId,
        summary: `Сводная смета: ${parts.join(", ")}`,
        changes,
      },
      { db: tx },
    );
    return true;
  });

  revalidate(projectId);
  return { success: changed ? "Сохранено" : "Без изменений" };
}
