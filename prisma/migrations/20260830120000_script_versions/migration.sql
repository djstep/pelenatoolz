-- CreateEnum
CREATE TYPE "ScriptVersionSourceType" AS ENUM ('IMPORTED_DOCX', 'IMPORTED_OTHER', 'MANUAL', 'DUPLICATED_FROM');

-- CreateTable
CREATE TABLE "ScriptVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" "ScriptVersionSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptVersion_pkey" PRIMARY KEY ("id")
);

-- Add scriptVersionId to ScriptBlock (nullable for backfill)
ALTER TABLE "ScriptBlock" ADD COLUMN "scriptVersionId" TEXT;

-- Backfill: one initial version per project that has script blocks
INSERT INTO "ScriptVersion" ("id", "projectId", "versionNumber", "title", "isCurrent", "sourceType", "createdById", "createdAt")
SELECT
    'sv_' || p."id",
    p."id",
    1,
    'Начальная версия',
    true,
    'MANUAL',
    p."createdById",
    NOW()
FROM "Project" p
WHERE EXISTS (SELECT 1 FROM "ScriptBlock" sb WHERE sb."projectId" = p."id")
   OR EXISTS (SELECT 1 FROM "Scene" s WHERE s."projectId" = p."id");

UPDATE "ScriptBlock" sb
SET "scriptVersionId" = 'sv_' || sb."projectId"
WHERE sb."scriptVersionId" IS NULL
  AND EXISTS (SELECT 1 FROM "ScriptVersion" sv WHERE sv."id" = 'sv_' || sb."projectId");

-- Projects with scenes but no blocks still get a version row from INSERT above

ALTER TABLE "ScriptBlock" ALTER COLUMN "scriptVersionId" SET NOT NULL;

-- Drop old index, add new indexes
DROP INDEX IF EXISTS "ScriptBlock_projectId_sortOrder_idx";
CREATE INDEX "ScriptBlock_scriptVersionId_sortOrder_idx" ON "ScriptBlock"("scriptVersionId", "sortOrder");
CREATE INDEX "ScriptBlock_projectId_scriptVersionId_idx" ON "ScriptBlock"("projectId", "scriptVersionId");

-- ScriptImportJob
ALTER TABLE "ScriptImportJob" ADD COLUMN "scriptVersionId" TEXT;

-- Foreign keys
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "ScriptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScriptBlock" ADD CONSTRAINT "ScriptBlock_scriptVersionId_fkey" FOREIGN KEY ("scriptVersionId") REFERENCES "ScriptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScriptImportJob" ADD CONSTRAINT "ScriptImportJob_scriptVersionId_fkey" FOREIGN KEY ("scriptVersionId") REFERENCES "ScriptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ScriptVersion_projectId_versionNumber_key" ON "ScriptVersion"("projectId", "versionNumber");
CREATE INDEX "ScriptVersion_projectId_isCurrent_idx" ON "ScriptVersion"("projectId", "isCurrent");
CREATE INDEX "ScriptVersion_createdById_idx" ON "ScriptVersion"("createdById");
CREATE INDEX "ScriptImportJob_scriptVersionId_idx" ON "ScriptImportJob"("scriptVersionId");
