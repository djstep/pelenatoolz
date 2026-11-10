import { BudgetStatus, BudgetVersionFormat, Prisma } from "@prisma/client";
import type { prisma as SharedPrisma } from "../../src/shared/db/prisma";
import { createBudgetDefaults } from "../../src/features/smeta/lib/budget-defaults";
import { calcItem } from "../../src/features/smeta/lib/item-calc";
import { lineCode } from "../../src/features/smeta/lib/item-input";
import { buildItemsSnapshot, snapshotDiffSources, type SnapshotSourceArticle } from "../../src/features/smeta/lib/items-snapshot";
import { effectiveVariableValue } from "../../src/features/finance/lib/variable-values";

/**
 * Сид сметы по статьям (волна «Смета по статьям», шаг 9): шаблон статей, два цеха со сметами
 * в новой модели (один — с утверждённой версией), значения переменных, формы оплаты, резерв
 * и агентские. Повторный запуск ничего не дублирует: цех, где статьи уже есть, не трогается.
 * Справочники (типы расходов, формы оплаты, переменные) — те же, что у нового проекта.
 */

type Line = { name: string; unit: string; quantity: number; rate: number; smeny?: boolean; extra?: number; form: string; type: string };
type Sub = { name: string; lines: Line[] };
type Article = { template: string; subs: Sub[] };
type Dept = { name: string; codePrefix: string; approve: boolean; articles: Article[] };

const TEMPLATE = ["Операторская группа", "Техника", "Транспорт", "Звук"];

export const SEED_SMETA_DEPARTMENTS: Dept[] = [
  {
    name: "Операторский цех",
    codePrefix: "OP",
    approve: false,
    articles: [
      {
        template: "Операторская группа",
        subs: [
          {
            name: "Персонал",
            lines: [
              { name: "Оператор-постановщик", unit: "смена", quantity: 1, rate: 45000, smeny: true, form: "Самозанятый", type: "Гонорар / ФОТ" },
              { name: "1-й ассистент оператора (фокус)", unit: "смена", quantity: 1, rate: 18000, smeny: true, form: "Самозанятый", type: "Гонорар / ФОТ" },
              { name: "DIT", unit: "смена", quantity: 1, rate: 15000, smeny: true, form: "ИП", type: "Гонорар / ФОТ" },
            ],
          },
        ],
      },
      {
        template: "Техника",
        subs: [
          {
            name: "Камера и оптика",
            lines: [
              { name: "Камера, комплект", unit: "смена", quantity: 1, rate: 38000, smeny: true, extra: 0.7, form: "Юрлицо", type: "Аренда техники" },
              { name: "Комплект оптики", unit: "смена", quantity: 1, rate: 22000, smeny: true, form: "Юрлицо", type: "Аренда техники" },
            ],
          },
        ],
      },
      {
        template: "Транспорт",
        subs: [{ name: "Спецтранспорт", lines: [{ name: "Камерваген", unit: "смена", quantity: 1, rate: 15000, smeny: true, form: "ИП", type: "Транспорт" }] }],
      },
    ],
  },
  {
    name: "Звуковой цех",
    codePrefix: "ZV",
    approve: true,
    articles: [
      {
        template: "Звук",
        subs: [
          {
            name: "Персонал",
            lines: [
              { name: "Звукорежиссёр", unit: "смена", quantity: 1, rate: 25000, smeny: true, form: "Самозанятый", type: "Гонорар / ФОТ" },
              { name: "Микрофонный оператор", unit: "смена", quantity: 1, rate: 12000, smeny: true, form: "Самозанятый", type: "Гонорар / ФОТ" },
            ],
          },
          { name: "Оборудование", lines: [{ name: "Комплект радиосистем", unit: "смена", quantity: 1, rate: 9000, smeny: true, form: "Юрлицо", type: "Аренда техники" }] },
        ],
      },
      {
        template: "Транспорт",
        subs: [{ name: "Перевозка", lines: [{ name: "Тонваген", unit: "смена", quantity: 1, rate: 8000, smeny: true, form: "ИП", type: "Транспорт" }] }],
      },
    ],
  },
];

const D = Prisma.Decimal;

export async function seedSmetaItems(db: typeof SharedPrisma, input: { projectId: string; producerUserId: string }) {
  const { projectId, producerUserId } = input;
  const log: string[] = [];
  await db.$transaction(
    async (tx) => {
      // Справочники — как у нового проекта (у старых их вставила миграция).
      if (!(await tx.projectBudgetSettings.findUnique({ where: { projectId } }))) await createBudgetDefaults(tx, projectId);
      // Резерв и агентские — только если их ещё не задавали: свои значения сид не перезаписывает.
      const settings = await tx.projectBudgetSettings.findUniqueOrThrow({ where: { projectId } });
      if (settings.reservePercent.isZero() && settings.agencyPercent.isZero()) {
        await tx.projectBudgetSettings.update({ where: { projectId }, data: { reservePercent: 5, agencyPercent: 3 } });
      }
      const smeny = await tx.projectFinanceVariable.findUniqueOrThrow({ where: { projectId_key: { projectId, key: "SMENY" } } });
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { shootingDaysCount: true, episodeCount: true } });
      if (effectiveVariableValue(smeny, project) == null) {
        await tx.projectFinanceVariable.update({ where: { id: smeny.id }, data: { value: 32 } });
      }
      const [types, forms, membership] = await Promise.all([
        tx.projectExpenseType.findMany({ where: { projectId }, select: { id: true, name: true } }),
        tx.projectPaymentForm.findMany({ where: { projectId }, select: { id: true, name: true, defaultTaxPercent: true } }),
        tx.projectMembership.findFirstOrThrow({ where: { projectId, userId: producerUserId }, select: { id: true } }),
      ]);
      const variableRows = await tx.projectFinanceVariable.findMany({
        where: { projectId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, key: true, label: true, value: true },
      });
      const variables = variableRows.map((v) => ({ id: v.id, key: v.key, label: v.label, value: effectiveVariableValue(v, project) }));
      const values = new Map(variables.map((v) => [v.id, v.value]));

      // Шаблон статей фильма: номера не переиспользуются (счётчик в настройках).
      const templates = new Map<string, { id: string; number: number }>();
      for (const [index, name] of TEMPLATE.entries()) {
        let t = await tx.budgetTemplateArticle.findFirst({ where: { projectId, name }, select: { id: true, number: true } });
        if (!t) {
          const { lastTemplateArticleNumber: number } = await tx.projectBudgetSettings.update({
            where: { projectId },
            data: { lastTemplateArticleNumber: { increment: 1 } },
            select: { lastTemplateArticleNumber: true },
          });
          t = await tx.budgetTemplateArticle.create({ data: { projectId, number, name, sortOrder: index }, select: { id: true, number: true } });
        }
        templates.set(name, t);
      }

      for (const dept of SEED_SMETA_DEPARTMENTS) {
        let department = await tx.department.findFirst({ where: { projectId, name: dept.name }, select: { id: true, codePrefix: true } });
        if (!department) {
          const taken = await tx.department.findFirst({ where: { projectId, codePrefix: dept.codePrefix }, select: { name: true } });
          if (taken) {
            throw new Error(`Префикс ${dept.codePrefix} уже у цеха «${taken.name}» — сид цеха «${dept.name}» не создан`);
          }
          department = await tx.department.create({ data: { projectId, name: dept.name, codePrefix: dept.codePrefix }, select: { id: true, codePrefix: true } });
        }
        const head = await tx.departmentHead.findFirst({ where: { departmentId: department.id, membershipId: membership.id } });
        if (!head) await tx.departmentHead.create({ data: { departmentId: department.id, membershipId: membership.id } });
        const budget =
          (await tx.budget.findFirst({ where: { projectId, departmentId: department.id }, select: { id: true } })) ??
          (await tx.budget.create({ data: { projectId, departmentId: department.id, createdById: producerUserId }, select: { id: true } }));
        if ((await tx.budgetArticle.count({ where: { budgetId: budget.id } })) > 0) continue;

        const source: SnapshotSourceArticle[] = [];
        for (const article of dept.articles) {
          const template = templates.get(article.template)!;
          const a = await tx.budgetArticle.create({
            data: { projectId, budgetId: budget.id, templateArticleId: template.id, lastSubarticleNumber: article.subs.length },
            select: { id: true },
          });
          const two = (n: number) => String(n).padStart(2, "0");
          const subs: SnapshotSourceArticle["subarticles"] = [];
          for (const [si, sub] of article.subs.entries()) {
            const s = await tx.budgetSubarticle.create({
              data: { projectId, articleId: a.id, number: si + 1, name: sub.name, sortOrder: si, lastLineNumber: sub.lines.length },
              select: { id: true },
            });
            const items: SnapshotSourceArticle["subarticles"][number]["items"] = [];
            for (const [li, line] of sub.lines.entries()) {
              const form = forms.find((f) => f.name === line.form) ?? null;
              const type = types.find((t) => t.name === line.type) ?? null;
              const taxPercent = form?.defaultTaxPercent ?? null;
              const multipliers = [line.smeny ? { variableId: smeny.id } : null, line.extra != null ? { value: line.extra } : null, null];
              const calc = calcItem({ quantity: line.quantity, rate: line.rate, multipliers, taxPercent }, values);
              const code = lineCode(department.codePrefix, template.number, si + 1, li + 1);
              const item = await tx.budgetItem.create({
                data: {
                  projectId,
                  departmentId: department.id,
                  subarticleId: s.id,
                  number: li + 1,
                  code,
                  name: line.name,
                  unit: line.unit,
                  quantity: line.quantity,
                  rate: line.rate,
                  taxPercent,
                  expenseTypeId: type?.id ?? null,
                  paymentFormId: form?.id ?? null,
                  multiplier1VariableId: line.smeny ? smeny.id : null,
                  multiplier2Value: line.extra ?? null,
                  amount: new D(calc.amount?.toFixed(2) ?? 0),
                  tax: new D(calc.tax?.toFixed(2) ?? 0),
                  total: new D(calc.total?.toFixed(2) ?? 0),
                  sortOrder: li,
                },
                select: { id: true },
              });
              items.push({
                id: item.id,
                code,
                name: line.name,
                unit: line.unit,
                quantity: String(line.quantity),
                rate: String(line.rate),
                taxPercent: taxPercent?.toString() ?? null,
                expenseType: type?.name ?? null,
                paymentForm: form?.name ?? null,
                expenseTypeId: type?.id ?? null,
                paymentFormId: form?.id ?? null,
                multiplier1VariableId: line.smeny ? smeny.id : null,
                multiplier1Value: null,
                multiplier2VariableId: null,
                multiplier2Value: line.extra != null ? String(line.extra) : null,
                multiplier3VariableId: null,
                multiplier3Value: null,
              });
            }
            subs.push({ id: s.id, code: `${department.codePrefix}-${two(template.number)}.${two(si + 1)}`, name: sub.name, items });
          }
          source.push({ id: a.id, code: `${department.codePrefix}-${two(template.number)}`, templateArticleId: template.id, name: article.template, subarticles: subs });
        }

        if (dept.approve && (await tx.budgetVersion.count({ where: { budgetId: budget.id } })) === 0) {
          const snapshot = buildItemsSnapshot(source, variables);
          const producer = await tx.user.findUniqueOrThrow({ where: { id: producerUserId }, select: { name: true } });
          await tx.budgetVersion.create({
            data: {
              projectId,
              departmentId: department.id,
              budgetId: budget.id,
              number: 1,
              revision: 0,
              approvedById: producerUserId,
              approvedByName: producer.name,
              approvedByHead: true,
              total: new D(snapshot.totals.total),
              itemCount: snapshot.lineCount,
              format: BudgetVersionFormat.ITEMS,
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
              lines: {
                create: snapshotDiffSources(snapshot).map((l) => ({
                  budgetItemId: l.itemId,
                  code: l.code,
                  name: l.name,
                  unit: l.unit,
                  quantity: l.quantity,
                  rate: l.rate,
                  amount: l.amount,
                  taxPercent: l.taxPercent,
                  tax: l.tax,
                  total: l.total,
                  sortOrder: l.sortOrder,
                })),
              },
            },
          });
          await tx.budget.update({ where: { id: budget.id }, data: { status: BudgetStatus.APPROVED } });
        }
        log.push(`${dept.name}: ${dept.articles.reduce((n, a) => n + a.subs.reduce((m, s) => m + s.lines.length, 0), 0)} строк${dept.approve ? ", утверждена версия 1" : ""}`);
      }
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
  return log;
}
