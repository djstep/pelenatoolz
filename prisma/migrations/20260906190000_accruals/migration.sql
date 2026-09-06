-- CreateEnum
CREATE TYPE "BudgetLinkedResourceType" AS ENUM ('ACTOR', 'RESOURCE_ITEM');
CREATE TYPE "AccrualType" AS ENUM ('PER_SHIFT', 'ONE_TIME');

-- AlterTable
ALTER TABLE "BudgetLine" ADD COLUMN "linkedResourceType" "BudgetLinkedResourceType";
ALTER TABLE "BudgetLine" ADD COLUMN "linkedResourceId" TEXT;

-- CreateTable
CREATE TABLE "Accrual" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "quantity" DECIMAL(12,2),
    "counterpartyId" TEXT NOT NULL,
    "taxPercent" DECIMAL(5,2),
    "taxAmount" DECIMAL(14,2),
    "amountWithTax" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "groupUnit" TEXT,
    "type" "AccrualType" NOT NULL DEFAULT 'ONE_TIME',
    "shootDayId" TEXT,
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accrual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetLine_projectId_linkedResourceType_linkedResourceId_idx" ON "BudgetLine"("projectId", "linkedResourceType", "linkedResourceId");
CREATE INDEX "Accrual_projectId_date_idx" ON "Accrual"("projectId", "date");
CREATE INDEX "Accrual_projectId_budgetLineId_idx" ON "Accrual"("projectId", "budgetLineId");
CREATE INDEX "Accrual_projectId_counterpartyId_idx" ON "Accrual"("projectId", "counterpartyId");
CREATE INDEX "Accrual_projectId_groupUnit_idx" ON "Accrual"("projectId", "groupUnit");
CREATE INDEX "Accrual_shootDayId_idx" ON "Accrual"("shootDayId");

-- AddForeignKey
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
