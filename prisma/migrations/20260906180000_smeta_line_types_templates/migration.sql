-- CreateEnum
CREATE TYPE "BudgetLineType" AS ENUM ('PER_SHIFT', 'ONE_TIME', 'MONTHLY', 'DAILY');

-- AlterTable BudgetLine
ALTER TABLE "BudgetLine" ADD COLUMN "lineType" "BudgetLineType" NOT NULL DEFAULT 'ONE_TIME';
ALTER TABLE "BudgetLine" ADD COLUMN "unitsCount" DECIMAL(12,2) NOT NULL DEFAULT 1;
ALTER TABLE "BudgetLine" ADD COLUMN "quantityAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "BudgetLine" ADD COLUMN "plannedCounterpartyId" TEXT;
ALTER TABLE "BudgetLine" ADD COLUMN "taxPercent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "BudgetTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "BudgetTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetTemplate_projectId_name_idx" ON "BudgetTemplate"("projectId", "name");
CREATE INDEX "BudgetLine_projectId_lineType_idx" ON "BudgetLine"("projectId", "lineType");
CREATE INDEX "BudgetLine_plannedCounterpartyId_idx" ON "BudgetLine"("plannedCounterpartyId");

-- AddForeignKey
ALTER TABLE "BudgetTemplate" ADD CONSTRAINT "BudgetTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetTemplate" ADD CONSTRAINT "BudgetTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_plannedCounterpartyId_fkey" FOREIGN KEY ("plannedCounterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
