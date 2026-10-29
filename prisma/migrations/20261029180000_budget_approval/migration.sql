-- Утверждение смет цехов и неизменяемые версии (волна 2, шаг 3).

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED');

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "changedAfterSubmitAt" TIMESTAMP(3),
ADD COLUMN     "returnComment" TEXT,
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "returnedById" TEXT,
ADD COLUMN     "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "submitComment" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "submittedRevision" INTEGER;

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "approvedByHead" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submitComment" TEXT,
    "total" DECIMAL(18,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "sheetName" TEXT NOT NULL,
    "sheetData" JSONB NOT NULL,
    "styles" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetVersionLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "budgetItemId" TEXT NOT NULL,
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

    CONSTRAINT "BudgetVersionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetVersion_projectId_idx" ON "BudgetVersion"("projectId");

-- CreateIndex
CREATE INDEX "BudgetVersion_budgetId_idx" ON "BudgetVersion"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetVersion_departmentId_number_key" ON "BudgetVersion"("departmentId", "number");

-- CreateIndex
CREATE INDEX "BudgetVersionLine_budgetItemId_idx" ON "BudgetVersionLine"("budgetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetVersionLine_versionId_budgetItemId_key" ON "BudgetVersionLine"("versionId", "budgetItemId");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersionLine" ADD CONSTRAINT "BudgetVersionLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BudgetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersionLine" ADD CONSTRAINT "BudgetVersionLine_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Неизменяемость утверждённых версий.
-- UPDATE версий и строк запрещён всегда.
-- DELETE разрешён только как каскад удаления всего проекта: каскад по внешнему ключу
-- выполняется после удаления строки проекта, поэтому в триггере проекта уже нет.
-- Строки версии удаляются каскадом от версии — так же, после удаления самой версии.
CREATE FUNCTION "budget_version_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "Project" WHERE "id" = OLD."projectId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Утверждённая версия сметы не изменяется и не удаляется';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "budget_version_line_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "BudgetVersion" WHERE "id" = OLD."versionId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Строка утверждённой версии сметы не изменяется и не удаляется';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BudgetVersion_immutable"
  BEFORE UPDATE OR DELETE ON "BudgetVersion"
  FOR EACH ROW EXECUTE FUNCTION "budget_version_immutable"();

CREATE TRIGGER "BudgetVersionLine_immutable"
  BEFORE UPDATE OR DELETE ON "BudgetVersionLine"
  FOR EACH ROW EXECUTE FUNCTION "budget_version_line_immutable"();
