-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('LEGAL_ENTITY', 'IP', 'INDIVIDUAL', 'SELF_EMPLOYED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requisites" TEXT,
    "inn" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CounterpartyType" NOT NULL DEFAULT 'LEGAL_ENTITY',
    "contacts" TEXT,
    "inn" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FinanceOperation" ADD COLUMN "companyId" TEXT;
ALTER TABLE "FinanceOperation" ADD COLUMN "counterpartyId" TEXT;

-- CreateIndex
CREATE INDEX "Company_projectId_name_idx" ON "Company"("projectId", "name");

-- CreateIndex
CREATE INDEX "Counterparty_projectId_name_idx" ON "Counterparty"("projectId", "name");

-- CreateIndex
CREATE INDEX "Counterparty_projectId_type_idx" ON "Counterparty"("projectId", "type");

-- CreateIndex
CREATE INDEX "FinanceOperation_companyId_idx" ON "FinanceOperation"("companyId");

-- CreateIndex
CREATE INDEX "FinanceOperation_counterpartyId_idx" ON "FinanceOperation"("counterpartyId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceOperation" ADD CONSTRAINT "FinanceOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceOperation" ADD CONSTRAINT "FinanceOperation_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
