-- CreateEnum
CREATE TYPE "ProductionWorkKind" AS ENUM ('ACTOR', 'RESOURCE', 'TRANSPORT', 'LOCATION');

-- CreateTable
CREATE TABLE "ProductionReportWorkRow" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "ProductionWorkKind" NOT NULL,
    "actorId" TEXT,
    "resourceItemId" TEXT,
    "locationId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "categoryLabel" TEXT,
    "factStart" TEXT,
    "factEnd" TEXT,
    "lunchSkipped" BOOLEAN NOT NULL DEFAULT false,
    "workedMin" INTEGER,
    "factOvertimeMin" INTEGER,
    "payableOvertimeMin" INTEGER,
    "shiftHoursMin" INTEGER,
    "unpaidOvertimeMin" INTEGER,
    "shiftRate" DECIMAL(12,2),
    "forceMajeurePct" DECIMAL(6,2),
    "shiftPay" DECIMAL(14,2),
    "overtimePay" DECIMAL(14,2),
    "extrasPay" DECIMAL(14,2),
    "totalPay" DECIMAL(14,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReportWorkRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReportWorkExtra" (
    "id" TEXT NOT NULL,
    "workRowId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReportWorkExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shootDayId" TEXT,
    "workRowId" TEXT,
    "actorId" TEXT,
    "resourceItemId" TEXT,
    "category" "FinanceOpCategory" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReportWorkRow_reportId_sourceKey_key" ON "ProductionReportWorkRow"("reportId", "sourceKey");
CREATE INDEX "ProductionReportWorkRow_reportId_sortOrder_idx" ON "ProductionReportWorkRow"("reportId", "sortOrder");
CREATE INDEX "ProductionReportWorkRow_actorId_idx" ON "ProductionReportWorkRow"("actorId");
CREATE INDEX "ProductionReportWorkRow_resourceItemId_idx" ON "ProductionReportWorkRow"("resourceItemId");
CREATE INDEX "ProductionReportWorkExtra_workRowId_idx" ON "ProductionReportWorkExtra"("workRowId");
CREATE UNIQUE INDEX "Payment_workRowId_key" ON "Payment"("workRowId");
CREATE INDEX "Payment_projectId_paymentDate_idx" ON "Payment"("projectId", "paymentDate");
CREATE INDEX "Payment_shootDayId_idx" ON "Payment"("shootDayId");
CREATE INDEX "Payment_actorId_idx" ON "Payment"("actorId");

-- AddForeignKey
ALTER TABLE "ProductionReportWorkRow" ADD CONSTRAINT "ProductionReportWorkRow_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProductionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionReportWorkRow" ADD CONSTRAINT "ProductionReportWorkRow_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionReportWorkRow" ADD CONSTRAINT "ProductionReportWorkRow_resourceItemId_fkey" FOREIGN KEY ("resourceItemId") REFERENCES "ResourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionReportWorkRow" ADD CONSTRAINT "ProductionReportWorkRow_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionReportWorkExtra" ADD CONSTRAINT "ProductionReportWorkExtra_workRowId_fkey" FOREIGN KEY ("workRowId") REFERENCES "ProductionReportWorkRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_workRowId_fkey" FOREIGN KEY ("workRowId") REFERENCES "ProductionReportWorkRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
