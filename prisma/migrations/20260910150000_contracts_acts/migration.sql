-- AlterTable Accrual
ALTER TABLE "Accrual" ADD COLUMN "contractId" TEXT;

-- AlterTable CashPayment
ALTER TABLE "CashPayment" ADD COLUMN "contractId" TEXT;

-- CreateEnum
CREATE TYPE "ContractFileRole" AS ENUM ('SCAN', 'ORIGINAL', 'OTHER');

-- CreateTable
CREATE TABLE "ProjectLedgerType" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLedgerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "ledgerTypeId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "vatRate" DECIMAL(5,2),
    "vatAmount" DECIMAL(14,2),
    "amountWithVat" DECIMAL(14,2) NOT NULL,
    "isPreliminary" BOOLEAN NOT NULL DEFAULT false,
    "statusId" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "comment" TEXT,
    "creditsName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractFile" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "role" "ContractFileRole" NOT NULL DEFAULT 'OTHER',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Act" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "contractId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "vatRate" DECIMAL(5,2),
    "vatAmount" DECIMAL(14,2),
    "amountWithVat" DECIMAL(14,2) NOT NULL,
    "statusId" TEXT NOT NULL,
    "summary" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActFile" (
    "id" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActFile_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Accrual_contractId_idx" ON "Accrual"("contractId");
CREATE INDEX "CashPayment_contractId_idx" ON "CashPayment"("contractId");

CREATE INDEX "ProjectLedgerType_projectId_sortOrder_idx" ON "ProjectLedgerType"("projectId", "sortOrder");
CREATE UNIQUE INDEX "ProjectLedgerType_projectId_name_key" ON "ProjectLedgerType"("projectId", "name");

CREATE INDEX "Contract_projectId_date_idx" ON "Contract"("projectId", "date");
CREATE INDEX "Contract_projectId_counterpartyId_idx" ON "Contract"("projectId", "counterpartyId");
CREATE INDEX "Contract_projectId_companyId_idx" ON "Contract"("projectId", "companyId");
CREATE INDEX "Contract_projectId_statusId_idx" ON "Contract"("projectId", "statusId");
CREATE INDEX "Contract_projectId_ledgerTypeId_idx" ON "Contract"("projectId", "ledgerTypeId");
CREATE INDEX "Contract_projectId_number_idx" ON "Contract"("projectId", "number");

CREATE UNIQUE INDEX "ContractFile_contractId_fileId_key" ON "ContractFile"("contractId", "fileId");
CREATE INDEX "ContractFile_fileId_idx" ON "ContractFile"("fileId");

CREATE INDEX "Act_projectId_date_idx" ON "Act"("projectId", "date");
CREATE INDEX "Act_projectId_counterpartyId_idx" ON "Act"("projectId", "counterpartyId");
CREATE INDEX "Act_projectId_contractId_idx" ON "Act"("projectId", "contractId");
CREATE INDEX "Act_projectId_statusId_idx" ON "Act"("projectId", "statusId");

CREATE UNIQUE INDEX "ActFile_actId_fileId_key" ON "ActFile"("actId", "fileId");
CREATE INDEX "ActFile_fileId_idx" ON "ActFile"("fileId");

-- FKs
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectLedgerType" ADD CONSTRAINT "ProjectLedgerType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ledgerTypeId_fkey" FOREIGN KEY ("ledgerTypeId") REFERENCES "ProjectLedgerType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "ProjectApprovalStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Act" ADD CONSTRAINT "Act_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Act" ADD CONSTRAINT "Act_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Act" ADD CONSTRAINT "Act_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Act" ADD CONSTRAINT "Act_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Act" ADD CONSTRAINT "Act_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "ProjectApprovalStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActFile" ADD CONSTRAINT "ActFile_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActFile" ADD CONSTRAINT "ActFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
