-- AlterTable
ALTER TABLE "BudgetLine" ADD COLUMN "quantityVariableKey" TEXT;

-- CreateTable
CREATE TABLE "ProjectFinanceVariable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFinanceVariable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectFinanceVariable_projectId_sortOrder_idx" ON "ProjectFinanceVariable"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFinanceVariable_projectId_key_key" ON "ProjectFinanceVariable"("projectId", "key");

-- AddForeignKey
ALTER TABLE "ProjectFinanceVariable" ADD CONSTRAINT "ProjectFinanceVariable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
