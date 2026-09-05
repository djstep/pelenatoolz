-- DropTable (prototype EstimateWorkbook → structured Budget/Sheet/SheetData)
DROP TABLE IF EXISTS "EstimateWorkbook";

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Смета',
    "styles" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSheet" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BudgetSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSheetData" (
    "sheetId" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "BudgetSheetData_pkey" PRIMARY KEY ("sheetId")
);

-- CreateIndex
CREATE INDEX "Budget_projectId_idx" ON "Budget"("projectId");

-- CreateIndex
CREATE INDEX "BudgetSheet_budgetId_sortOrder_idx" ON "BudgetSheet"("budgetId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSheet" ADD CONSTRAINT "BudgetSheet_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSheetData" ADD CONSTRAINT "BudgetSheetData_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "BudgetSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
