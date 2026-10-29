-- Сметы цехов (волна 2, шаг 2).
-- Старые книги смет без цеха и свои шаблоны удаляются (разрешено владельцем):
-- книга теперь всегда принадлежит цеху, основной лист — из встроенного шаблона.

-- Удалить старые книги (листы и данные листов удаляются каскадом)
DELETE FROM "Budget";

-- DropForeignKey
ALTER TABLE "BudgetTemplate" DROP CONSTRAINT "BudgetTemplate_createdById_fkey";

-- DropForeignKey
ALTER TABLE "BudgetTemplate" DROP CONSTRAINT "BudgetTemplate_projectId_fkey";

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "departmentId" TEXT NOT NULL,
ADD COLUMN     "mainSheetId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BudgetSheet" ADD COLUMN     "sheetKey" TEXT NOT NULL;

-- DropTable
DROP TABLE "BudgetTemplate";

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(18,4),
    "rate" DECIMAL(18,2),
    "days" DECIMAL(18,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "taxPercent" DECIMAL(9,4),
    "tax" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetItem_departmentId_archivedAt_idx" ON "BudgetItem"("departmentId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetItem_projectId_code_key" ON "BudgetItem"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_departmentId_key" ON "Budget"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_mainSheetId_key" ON "Budget"("mainSheetId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetSheet_budgetId_sheetKey_key" ON "BudgetSheet"("budgetId", "sheetKey");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_mainSheetId_fkey" FOREIGN KEY ("mainSheetId") REFERENCES "BudgetSheet"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

