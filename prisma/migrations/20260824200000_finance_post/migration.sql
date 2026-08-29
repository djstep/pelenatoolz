-- CreateEnum
CREATE TYPE "FinanceOpType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceOpCategory" AS ENUM ('CAST_PAY', 'CREW_PAY', 'VENDOR', 'LOCATION', 'EQUIPMENT', 'TRANSPORT', 'CATERING', 'GRANT', 'SPONSOR', 'OTHER');

-- CreateEnum
CREATE TYPE "PostStage" AS ENUM ('INGEST', 'EDIT', 'VFX', 'COLOR', 'SOUND', 'GRAPHICS', 'DELIVERY');

-- CreateEnum
CREATE TYPE "PostTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- CreateTable
CREATE TABLE "FinanceOperation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "FinanceOpType" NOT NULL,
    "category" "FinanceOpCategory" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "counterparty" TEXT,
    "notes" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "PostStage" NOT NULL DEFAULT 'EDIT',
    "status" "PostTaskStatus" NOT NULL DEFAULT 'TODO',
    "title" TEXT NOT NULL,
    "episodeNumber" INTEGER,
    "assignee" TEXT,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceOperation_projectId_operationDate_idx" ON "FinanceOperation"("projectId", "operationDate");

-- CreateIndex
CREATE INDEX "FinanceOperation_projectId_type_idx" ON "FinanceOperation"("projectId", "type");

-- CreateIndex
CREATE INDEX "FinanceOperation_actorId_idx" ON "FinanceOperation"("actorId");

-- CreateIndex
CREATE INDEX "PostTask_projectId_stage_idx" ON "PostTask"("projectId", "stage");

-- CreateIndex
CREATE INDEX "PostTask_projectId_status_idx" ON "PostTask"("projectId", "status");

-- CreateIndex
CREATE INDEX "PostTask_projectId_sortOrder_idx" ON "PostTask"("projectId", "sortOrder");

-- AddForeignKey
ALTER TABLE "FinanceOperation" ADD CONSTRAINT "FinanceOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceOperation" ADD CONSTRAINT "FinanceOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTask" ADD CONSTRAINT "PostTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
