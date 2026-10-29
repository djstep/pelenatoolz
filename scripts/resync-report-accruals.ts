/**
 * Разовый пересчёт начислений из отчётов смены (волна 2, шаг 4): по всем отчётам всех
 * проектов создаёт начисления по частям оплаты строк (смена, переработка, доплаты, км).
 * Повторный запуск ничего не дублирует — начисление на строку и часть одно.
 *
 *   npx tsx scripts/resync-report-accruals.ts
 */
import "dotenv/config";
import { syncReportAccruals } from "../src/features/reports/lib/sync-accruals";
import { prisma } from "../src/shared/db/prisma";

async function main() {
  const before = await prisma.accrual.count({ where: { reportPart: { not: null } } });
  const reports = await prisma.productionReport.findMany({
    select: { shootDay: { select: { id: true, projectId: true, dayNumber: true } } },
  });
  for (const r of reports) {
    await syncReportAccruals(null, r.shootDay.projectId, r.shootDay.id);
    console.log(`день ${r.shootDay.dayNumber} (${r.shootDay.projectId}) — готово`);
  }
  const after = await prisma.accrual.findMany({
    where: { reportPart: { not: null } },
    select: { reportPart: true, amount: true, amountWithTax: true, budgetItemId: true, counterpartyId: true },
  });
  console.log(`Отчётов: ${reports.length}. Начислений из отчётов было ${before}, стало ${after.length}.`);
  for (const a of after) {
    console.log(
      `  ${a.reportPart}: ${a.amount} / с налогом ${a.amountWithTax}, статья ${a.budgetItemId ?? "—"}, контрагент ${a.counterpartyId ?? "не указан"}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
