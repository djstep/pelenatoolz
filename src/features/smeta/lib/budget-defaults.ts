import type { CounterpartyType } from "@prisma/client";
import { SYSTEM_FINANCE_VARIABLES } from "@/features/finance/lib/variables";
import type { prisma } from "@/shared/db/prisma";

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
/** Транзакция базы. */
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;

/**
 * Начальные справочники сметы нового проекта. Эти же списки вставляет миграция
 * `smeta_items` в существующие проекты; совпадение проверяет юнит-тест.
 */

/** Типы расходов строки сметы. Налог от типа не зависит. */
export const DEFAULT_EXPENSE_TYPES: readonly { key: string; name: string }[] = [
  { key: "FEE", name: "Гонорар / ФОТ" },
  { key: "EQUIPMENT_RENT", name: "Аренда техники" },
  { key: "PURCHASE", name: "Покупка / расходники" },
  { key: "TRANSPORT", name: "Транспорт" },
  { key: "CONTRACTOR", name: "Услуги подрядчика" },
  { key: "LOCATIONS", name: "Площадки" },
  { key: "CATERING", name: "Питание" },
  { key: "ACCOMMODATION", name: "Проживание" },
  { key: "PER_DIEM", name: "Суточные" },
  { key: "OTHER", name: "Прочее" },
];

/**
 * Формы оплаты с процентом налога по умолчанию (налог на доход исполнителя, не НДС).
 * Пусто — процента по умолчанию нет, налог вводится руками (миграция `payment_form_defaults`).
 */
export const DEFAULT_PAYMENT_FORMS: readonly {
  key: string;
  name: string;
  defaultTaxPercent: number | null;
}[] = [
  { key: "SELF_EMPLOYED", name: "Самозанятый", defaultTaxPercent: 6 },
  { key: "IP", name: "ИП", defaultTaxPercent: 6 },
  { key: "GPH", name: "ГПХ", defaultTaxPercent: null },
  { key: "CASH", name: "Наличные", defaultTaxPercent: null },
  { key: "LEGAL_ENTITY", name: "Юрлицо", defaultTaxPercent: null },
];

/**
 * Тип контрагента → ключ формы оплаты: налог по умолчанию в договоре и акте.
 * Юрлицо и физлицо (ГПХ) не сопоставлены: налог уже в итоговой стоимости, по умолчанию выключен
 * (миграция `counterparty_mapping_defaults`).
 */
export const DEFAULT_COUNTERPARTY_PAYMENT_FORMS: readonly {
  counterpartyType: CounterpartyType;
  paymentFormKey: string;
}[] = [
  { counterpartyType: "IP", paymentFormKey: "IP" },
  { counterpartyType: "SELF_EMPLOYED", paymentFormKey: "SELF_EMPLOYED" },
];

/**
 * Создаёт справочники сметы нового проекта в транзакции его создания: настройки сводной,
 * типы расходов, формы оплаты, сопоставление типов контрагентов и системные переменные
 * (значения пустые). Открытие страниц в базу ничего не пишет — всё создаётся здесь.
 */
export async function createBudgetDefaults(tx: Tx, projectId: string) {
  await tx.projectBudgetSettings.create({ data: { projectId } });

  await tx.projectExpenseType.createMany({
    data: DEFAULT_EXPENSE_TYPES.map((t, sortOrder) => ({
      projectId,
      key: t.key,
      name: t.name,
      isSystem: true,
      sortOrder,
    })),
  });

  const forms = await tx.projectPaymentForm.createManyAndReturn({
    data: DEFAULT_PAYMENT_FORMS.map((f, sortOrder) => ({
      projectId,
      key: f.key,
      name: f.name,
      defaultTaxPercent: f.defaultTaxPercent,
      isSystem: true,
      sortOrder,
    })),
    select: { id: true, key: true },
  });
  const formIdByKey = new Map(forms.map((f) => [f.key, f.id]));

  await tx.projectCounterpartyPaymentForm.createMany({
    data: DEFAULT_COUNTERPARTY_PAYMENT_FORMS.map((m) => ({
      projectId,
      counterpartyType: m.counterpartyType,
      paymentFormId: formIdByKey.get(m.paymentFormKey)!,
    })),
  });

  await tx.projectFinanceVariable.createMany({
    data: SYSTEM_FINANCE_VARIABLES.map((v) => ({
      projectId,
      key: v.key,
      label: v.label,
      value: null,
      isSystem: true,
      sortOrder: v.sortOrder,
    })),
  });
}
