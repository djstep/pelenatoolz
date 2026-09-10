-- CreateTable
CREATE TABLE "SceneShootAttempt" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "shootDate" TIMESTAMP(3) NOT NULL,
    "status" "ProductionSceneFactStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneShootAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SceneShootAttempt_sceneId_shootDate_idx" ON "SceneShootAttempt"("sceneId", "shootDate");

-- CreateIndex
CREATE INDEX "SceneShootAttempt_shootDayId_idx" ON "SceneShootAttempt"("shootDayId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneShootAttempt_sceneId_shootDayId_key" ON "SceneShootAttempt"("sceneId", "shootDayId");

-- AddForeignKey
ALTER TABLE "SceneShootAttempt" ADD CONSTRAINT "SceneShootAttempt_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneShootAttempt" ADD CONSTRAINT "SceneShootAttempt_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing production report scene facts
INSERT INTO "SceneShootAttempt" ("id", "sceneId", "shootDayId", "shootDate", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  f."sceneId",
  r."shootDayId",
  d."date",
  f."status",
  f."createdAt",
  f."updatedAt"
FROM "ProductionReportSceneFact" f
JOIN "ProductionReport" r ON r."id" = f."reportId"
JOIN "ShootDay" d ON d."id" = r."shootDayId"
ON CONFLICT ("sceneId", "shootDayId") DO NOTHING;
