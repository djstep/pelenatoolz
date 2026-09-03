-- CreateEnum
CREATE TYPE "ProductionSceneFactStatus" AS ENUM ('SHOT', 'NOT_SHOT', 'RESHOOT_REQUIRED', 'DELETED');

-- CreateTable
CREATE TABLE "ProductionReport" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "factShiftStart" TEXT,
    "factShiftEnd" TEXT,
    "lunchStart" TEXT,
    "lunchEnd" TEXT,
    "breakNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReportSceneFact" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "status" "ProductionSceneFactStatus" NOT NULL DEFAULT 'NOT_SHOT',
    "factSeconds" INTEGER,
    "prepStart" TEXT,
    "prepEnd" TEXT,
    "rehearsalStart" TEXT,
    "rehearsalEnd" TEXT,
    "motorStart" TEXT,
    "motorEnd" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "returnedToPool" BOOLEAN NOT NULL DEFAULT false,
    "sceneLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReportSceneFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReportMontageRow" (
    "id" TEXT NOT NULL,
    "sceneFactId" TEXT NOT NULL,
    "scenePart" TEXT,
    "frame" TEXT,
    "take" TEXT,
    "takeStatus" TEXT,
    "takeRuntime" TEXT,
    "cameraFiles" JSONB,
    "shotSize" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionReportMontageRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReport_shootDayId_key" ON "ProductionReport"("shootDayId");

-- CreateIndex
CREATE INDEX "ProductionReportSceneFact_reportId_sortOrder_idx" ON "ProductionReportSceneFact"("reportId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReportSceneFact_reportId_sceneId_key" ON "ProductionReportSceneFact"("reportId", "sceneId");

-- CreateIndex
CREATE INDEX "ProductionReportMontageRow_sceneFactId_sortOrder_idx" ON "ProductionReportMontageRow"("sceneFactId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReportSceneFact" ADD CONSTRAINT "ProductionReportSceneFact_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProductionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReportSceneFact" ADD CONSTRAINT "ProductionReportSceneFact_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReportMontageRow" ADD CONSTRAINT "ProductionReportMontageRow_sceneFactId_fkey" FOREIGN KEY ("sceneFactId") REFERENCES "ProductionReportSceneFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
