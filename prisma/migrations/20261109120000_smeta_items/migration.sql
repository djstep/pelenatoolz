-- CreateEnum
CREATE TYPE "BudgetVersionFormat" AS ENUM ('SHEET', 'ITEMS');

-- AlterTable
ALTER TABLE "BudgetItem" ADD COLUMN     "expenseTypeId" TEXT,
ADD COLUMN     "multiplier1Value" DECIMAL(18,4),
ADD COLUMN     "multiplier1VariableId" TEXT,
ADD COLUMN     "multiplier2Value" DECIMAL(18,4),
ADD COLUMN     "multiplier2VariableId" TEXT,
ADD COLUMN     "multiplier3Value" DECIMAL(18,4),
ADD COLUMN     "multiplier3VariableId" TEXT,
ADD COLUMN     "number" INTEGER,
ADD COLUMN     "paymentFormId" TEXT,
ADD COLUMN     "subarticleId" TEXT;

-- AlterTable
ALTER TABLE "BudgetVersion" ADD COLUMN     "format" "BudgetVersionFormat" NOT NULL DEFAULT 'SHEET',
ADD COLUMN     "snapshot" JSONB,
ALTER COLUMN "sheetName" DROP NOT NULL,
ALTER COLUMN "sheetData" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProjectFinanceVariable" ALTER COLUMN "value" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BudgetTemplateArticle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTemplateArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetArticle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "templateArticleId" TEXT NOT NULL,
    "lastSubarticleNumber" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSubarticle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastLineNumber" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetSubarticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgetSettings" (
    "projectId" TEXT NOT NULL,
    "reservePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "agencyPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lastTemplateArticleNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudgetSettings_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectExpenseType" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExpenseType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPaymentForm" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "defaultTaxPercent" DECIMAL(9,4),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPaymentForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCounterpartyPaymentForm" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "counterpartyType" "CounterpartyType" NOT NULL,
    "paymentFormId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCounterpartyPaymentForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetTemplateArticle_projectId_sortOrder_idx" ON "BudgetTemplateArticle"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTemplateArticle_projectId_number_key" ON "BudgetTemplateArticle"("projectId", "number");

-- CreateIndex
CREATE INDEX "BudgetArticle_projectId_idx" ON "BudgetArticle"("projectId");

-- CreateIndex
CREATE INDEX "BudgetArticle_templateArticleId_idx" ON "BudgetArticle"("templateArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetArticle_budgetId_templateArticleId_key" ON "BudgetArticle"("budgetId", "templateArticleId");

-- CreateIndex
CREATE INDEX "BudgetSubarticle_articleId_sortOrder_idx" ON "BudgetSubarticle"("articleId", "sortOrder");

-- CreateIndex
CREATE INDEX "BudgetSubarticle_projectId_idx" ON "BudgetSubarticle"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetSubarticle_articleId_number_key" ON "BudgetSubarticle"("articleId", "number");

-- CreateIndex
CREATE INDEX "ProjectExpenseType_projectId_sortOrder_idx" ON "ProjectExpenseType"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectExpenseType_projectId_name_key" ON "ProjectExpenseType"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectExpenseType_projectId_key_key" ON "ProjectExpenseType"("projectId", "key");

-- CreateIndex
CREATE INDEX "ProjectPaymentForm_projectId_sortOrder_idx" ON "ProjectPaymentForm"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPaymentForm_projectId_name_key" ON "ProjectPaymentForm"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPaymentForm_projectId_key_key" ON "ProjectPaymentForm"("projectId", "key");

-- CreateIndex
CREATE INDEX "ProjectCounterpartyPaymentForm_paymentFormId_idx" ON "ProjectCounterpartyPaymentForm"("paymentFormId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCounterpartyPaymentForm_projectId_counterpartyType_key" ON "ProjectCounterpartyPaymentForm"("projectId", "counterpartyType");

-- CreateIndex
CREATE INDEX "BudgetItem_subarticleId_sortOrder_idx" ON "BudgetItem"("subarticleId", "sortOrder");

-- CreateIndex
CREATE INDEX "BudgetItem_multiplier1VariableId_idx" ON "BudgetItem"("multiplier1VariableId");

-- CreateIndex
CREATE INDEX "BudgetItem_multiplier2VariableId_idx" ON "BudgetItem"("multiplier2VariableId");

-- CreateIndex
CREATE INDEX "BudgetItem_multiplier3VariableId_idx" ON "BudgetItem"("multiplier3VariableId");

-- CreateIndex
CREATE INDEX "BudgetItem_expenseTypeId_idx" ON "BudgetItem"("expenseTypeId");

-- CreateIndex
CREATE INDEX "BudgetItem_paymentFormId_idx" ON "BudgetItem"("paymentFormId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetItem_subarticleId_number_key" ON "BudgetItem"("subarticleId", "number");

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_subarticleId_fkey" FOREIGN KEY ("subarticleId") REFERENCES "BudgetSubarticle"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_expenseTypeId_fkey" FOREIGN KEY ("expenseTypeId") REFERENCES "ProjectExpenseType"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_paymentFormId_fkey" FOREIGN KEY ("paymentFormId") REFERENCES "ProjectPaymentForm"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_multiplier1VariableId_fkey" FOREIGN KEY ("multiplier1VariableId") REFERENCES "ProjectFinanceVariable"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_multiplier2VariableId_fkey" FOREIGN KEY ("multiplier2VariableId") REFERENCES "ProjectFinanceVariable"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_multiplier3VariableId_fkey" FOREIGN KEY ("multiplier3VariableId") REFERENCES "ProjectFinanceVariable"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTemplateArticle" ADD CONSTRAINT "BudgetTemplateArticle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetArticle" ADD CONSTRAINT "BudgetArticle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetArticle" ADD CONSTRAINT "BudgetArticle_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetArticle" ADD CONSTRAINT "BudgetArticle_templateArticleId_fkey" FOREIGN KEY ("templateArticleId") REFERENCES "BudgetTemplateArticle"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSubarticle" ADD CONSTRAINT "BudgetSubarticle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSubarticle" ADD CONSTRAINT "BudgetSubarticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BudgetArticle"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetSettings" ADD CONSTRAINT "ProjectBudgetSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpenseType" ADD CONSTRAINT "ProjectExpenseType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPaymentForm" ADD CONSTRAINT "ProjectPaymentForm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCounterpartyPaymentForm" ADD CONSTRAINT "ProjectCounterpartyPaymentForm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCounterpartyPaymentForm" ADD CONSTRAINT "ProjectCounterpartyPaymentForm_paymentFormId_fkey" FOREIGN KEY ("paymentFormId") REFERENCES "ProjectPaymentForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Проверки данных
-- ---------------------------------------------------------------------------

-- Множитель строки — переменная проекта или своё число, не оба сразу.
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_multiplier1_one_check"
  CHECK (num_nonnulls("multiplier1VariableId", "multiplier1Value") <= 1);
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_multiplier2_one_check"
  CHECK (num_nonnulls("multiplier2VariableId", "multiplier2Value") <= 1);
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_multiplier3_one_check"
  CHECK (num_nonnulls("multiplier3VariableId", "multiplier3Value") <= 1);

-- Строка новой сметы: подстатья и номер в ней есть вместе; у записи старого формата — оба пусты.
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_subarticle_number_check"
  CHECK (("subarticleId" IS NULL) = ("number" IS NULL));
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_number_positive_check"
  CHECK ("number" IS NULL OR "number" > 0);

-- Номера уровней — с 1; счётчики не меньше нуля.
ALTER TABLE "BudgetTemplateArticle" ADD CONSTRAINT "BudgetTemplateArticle_number_check"
  CHECK ("number" > 0);
ALTER TABLE "BudgetSubarticle" ADD CONSTRAINT "BudgetSubarticle_number_check"
  CHECK ("number" > 0 AND "lastLineNumber" >= 0);
ALTER TABLE "BudgetArticle" ADD CONSTRAINT "BudgetArticle_counter_check"
  CHECK ("lastSubarticleNumber" >= 0);

-- Проценты — от 0 до 100.
ALTER TABLE "ProjectBudgetSettings" ADD CONSTRAINT "ProjectBudgetSettings_percent_check"
  CHECK ("reservePercent" BETWEEN 0 AND 100 AND "agencyPercent" BETWEEN 0 AND 100
    AND "lastTemplateArticleNumber" >= 0);
ALTER TABLE "ProjectPaymentForm" ADD CONSTRAINT "ProjectPaymentForm_percent_check"
  CHECK ("defaultTaxPercent" IS NULL OR "defaultTaxPercent" BETWEEN 0 AND 100);

-- Версия старого формата — со снимком листа, новая — со снимком структуры.
-- Строки версий не меняются (триггер), здесь только проверка существующих.
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_format_check"
  CHECK (
    ("format" = 'SHEET' AND "sheetName" IS NOT NULL AND "sheetData" IS NOT NULL)
    OR ("format" = 'ITEMS' AND "snapshot" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Начальные справочники всем существующим проектам. Новым проектам их создаёт код
-- (`src/features/smeta/lib/budget-defaults.ts`), списки совпадают: это проверяет юнит-тест.
-- Повторный запуск ничего не дублирует (ON CONFLICT DO NOTHING).
-- ---------------------------------------------------------------------------

INSERT INTO "ProjectBudgetSettings" ("projectId", "updatedAt")
SELECT p."id", CURRENT_TIMESTAMP
FROM "Project" AS p
ON CONFLICT ("projectId") DO NOTHING;

-- Типы расходов (системные).
INSERT INTO "ProjectExpenseType" ("id", "projectId", "key", "name", "isSystem", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, p."id", t."key", t."name", true, t."sortOrder", CURRENT_TIMESTAMP
FROM "Project" AS p
CROSS JOIN (
  VALUES
    ('FEE', 'Гонорар / ФОТ', 0),
    ('EQUIPMENT_RENT', 'Аренда техники', 1),
    ('PURCHASE', 'Покупка / расходники', 2),
    ('TRANSPORT', 'Транспорт', 3),
    ('CONTRACTOR', 'Услуги подрядчика', 4),
    ('LOCATIONS', 'Площадки', 5),
    ('CATERING', 'Питание', 6),
    ('ACCOMMODATION', 'Проживание', 7),
    ('PER_DIEM', 'Суточные', 8),
    ('OTHER', 'Прочее', 9)
) AS t("key", "name", "sortOrder")
ON CONFLICT DO NOTHING;

-- Формы оплаты (системные) с процентом налога по умолчанию. Налог — на доход исполнителя.
INSERT INTO "ProjectPaymentForm" ("id", "projectId", "key", "name", "defaultTaxPercent", "isSystem", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, p."id", f."key", f."name", f."percent", true, f."sortOrder", CURRENT_TIMESTAMP
FROM "Project" AS p
CROSS JOIN (
  VALUES
    ('SELF_EMPLOYED', 'Самозанятый', 6, 0),
    ('IP', 'ИП', 6, 1),
    ('GPH', 'ГПХ', 13, 2),
    ('CASH', 'Наличные', 0, 3),
    ('LEGAL_ENTITY', 'Юрлицо', 0, 4)
) AS f("key", "name", "percent", "sortOrder")
ON CONFLICT DO NOTHING;

-- Тип контрагента → форма оплаты.
INSERT INTO "ProjectCounterpartyPaymentForm" ("id", "projectId", "counterpartyType", "paymentFormId", "updatedAt")
SELECT gen_random_uuid()::text, f."projectId", m."type"::"CounterpartyType", f."id", CURRENT_TIMESTAMP
FROM "ProjectPaymentForm" AS f
JOIN (
  VALUES
    ('LEGAL_ENTITY', 'LEGAL_ENTITY'),
    ('IP', 'IP'),
    ('SELF_EMPLOYED', 'SELF_EMPLOYED'),
    ('INDIVIDUAL', 'GPH')
) AS m("type", "formKey") ON m."formKey" = f."key"
ON CONFLICT ("projectId", "counterpartyType") DO NOTHING;

-- Переменные: своя «ДНИ ПОДГОТОВКИ» или «НЕДЕЛИ», заведённая раньше вручную, становится
-- системной (значение сохраняется) — чтобы в списке не было двух одинаковых.
UPDATE "ProjectFinanceVariable" AS v
SET "key" = s."key", "label" = s."label", "isSystem" = true, "sortOrder" = s."sortOrder", "updatedAt" = CURRENT_TIMESTAMP
FROM (
  VALUES
    ('DNI_PODGOTOVKI', 'ДНИ ПОДГОТОВКИ', 2),
    ('NEDELI', 'НЕДЕЛИ', 3)
) AS s("key", "label", "sortOrder")
WHERE v."id" IN (
    SELECT DISTINCT ON (c."projectId") c."id"
    FROM "ProjectFinanceVariable" AS c
    WHERE c."isSystem" = false AND upper(btrim(c."label")) = s."label"
    ORDER BY c."projectId", c."createdAt"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectFinanceVariable" AS e
    WHERE e."projectId" = v."projectId" AND e."key" = s."key"
  );

-- Системные переменные есть в каждом проекте: на них ссылаются строки сметы.
-- Значение пустое: у СМЕНЫ и СЕРИИ пусто = из параметров проекта, новые — просто пустые.
INSERT INTO "ProjectFinanceVariable" ("id", "projectId", "key", "label", "value", "isSystem", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, p."id", s."key", s."label", NULL, true, s."sortOrder", CURRENT_TIMESTAMP
FROM "Project" AS p
CROSS JOIN (
  VALUES
    ('SMENY', 'СМЕНЫ', 0),
    ('SERII', 'СЕРИИ', 1),
    ('DNI_PODGOTOVKI', 'ДНИ ПОДГОТОВКИ', 2),
    ('NEDELI', 'НЕДЕЛИ', 3)
) AS s("key", "label", "sortOrder")
ON CONFLICT ("projectId", "key") DO NOTHING;
