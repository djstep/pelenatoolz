-- Волна 2, шаг 4: начисления и платежи ссылаются на статьи смет цехов, вкладка «Статьи» уходит.
--
-- * Accrual / CashPaymentBreakdown: ссылка на BudgetItem (необязательная, пусто = «без статьи»)
--   вместо BudgetLine. Данных в старых таблицах нет (0 статей, 0 начислений, 0 платежей).
-- * Accrual из отчёта смены: строка отчёта + часть оплаты (смена, переработка, доплаты, км),
--   пометка «обнулено в отчёте», признак ручной правки статьи/контрагента; контрагент необязателен.
-- * Статьи по умолчанию у актёра, позиции ресурса и объекта.
-- * Удаляются BudgetLine и её перечисления, таблица Payment (2 записи, нигде не читалась —
--   её заменяют начисления из отчёта, пересчитываются скриптом после миграции).
-- * Раздел прав «Смета» (budget) убирается из матриц ролей.

-- CreateEnum
CREATE TYPE "AccrualReportPart" AS ENUM ('SHIFT', 'OVERTIME', 'EXTRAS', 'MILEAGE');

-- DropForeignKey
ALTER TABLE "Accrual" DROP CONSTRAINT "Accrual_budgetLineId_fkey";

-- DropForeignKey
ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_plannedCounterpartyId_fkey";

-- DropForeignKey
ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_projectId_fkey";

-- DropForeignKey
ALTER TABLE "CashPaymentBreakdown" DROP CONSTRAINT "CashPaymentBreakdown_budgetLineId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_actorId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_shootDayId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_workRowId_fkey";

-- DropIndex
DROP INDEX "Accrual_projectId_budgetLineId_idx";

-- DropIndex
DROP INDEX "CashPaymentBreakdown_budgetLineId_idx";

-- AlterTable
ALTER TABLE "Accrual" DROP COLUMN "budgetLineId",
ADD COLUMN     "budgetItemId" TEXT,
ADD COLUMN     "editedManually" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reportPart" "AccrualReportPart",
ADD COLUMN     "reportZeroedAt" TIMESTAMP(3),
ADD COLUMN     "workRowId" TEXT,
ALTER COLUMN "counterpartyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Actor" ADD COLUMN     "defaultBudgetItemId" TEXT,
ADD COLUMN     "overtimeBudgetItemId" TEXT;

-- AlterTable
ALTER TABLE "CashPaymentBreakdown" DROP COLUMN "budgetLineId",
ADD COLUMN     "budgetItemId" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "defaultBudgetItemId" TEXT,
ADD COLUMN     "overtimeBudgetItemId" TEXT;

-- AlterTable
ALTER TABLE "ResourceItem" ADD COLUMN     "defaultBudgetItemId" TEXT,
ADD COLUMN     "mileageBudgetItemId" TEXT,
ADD COLUMN     "overtimeBudgetItemId" TEXT;

-- DropTable
DROP TABLE "BudgetLine";

-- DropTable
DROP TABLE "Payment";

-- DropEnum
DROP TYPE "BudgetCategory";

-- DropEnum
DROP TYPE "BudgetLineType";

-- DropEnum
DROP TYPE "BudgetLinkedResourceType";

-- CreateIndex
CREATE INDEX "Accrual_projectId_budgetItemId_idx" ON "Accrual"("projectId", "budgetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Accrual_workRowId_reportPart_key" ON "Accrual"("workRowId", "reportPart");

-- CreateIndex
CREATE INDEX "CashPaymentBreakdown_budgetItemId_idx" ON "CashPaymentBreakdown"("budgetItemId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_defaultBudgetItemId_fkey" FOREIGN KEY ("defaultBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_overtimeBudgetItemId_fkey" FOREIGN KEY ("overtimeBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceItem" ADD CONSTRAINT "ResourceItem_defaultBudgetItemId_fkey" FOREIGN KEY ("defaultBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceItem" ADD CONSTRAINT "ResourceItem_overtimeBudgetItemId_fkey" FOREIGN KEY ("overtimeBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceItem" ADD CONSTRAINT "ResourceItem_mileageBudgetItemId_fkey" FOREIGN KEY ("mileageBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_defaultBudgetItemId_fkey" FOREIGN KEY ("defaultBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_overtimeBudgetItemId_fkey" FOREIGN KEY ("overtimeBudgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_workRowId_fkey" FOREIGN KEY ("workRowId") REFERENCES "ProductionReportWorkRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPaymentBreakdown" ADD CONSTRAINT "CashPaymentBreakdown_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Раздел «Смета» (budget:read / budget:write) больше не используется.
UPDATE "ProjectRoleDefinition"
SET "permissions" = "permissions" - 'budget'
WHERE jsonb_typeof("permissions") = 'object'
  AND "permissions" ? 'budget';
