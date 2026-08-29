-- FilmToolz foundation: custom roles, expanded project/scene/actor models

-- ProjectType: SERIES | FEATURE | SHORT
CREATE TYPE "ProjectType_new" AS ENUM ('SERIES', 'FEATURE', 'SHORT');
ALTER TABLE "Project" ALTER COLUMN "type" TYPE "ProjectType_new" USING (
  CASE
    WHEN "type"::text = 'SERIES' THEN 'SERIES'::"ProjectType_new"
    WHEN "type"::text = 'SHORT' THEN 'SHORT'::"ProjectType_new"
    ELSE 'FEATURE'::"ProjectType_new"
  END
);
DROP TYPE "ProjectType";
ALTER TYPE "ProjectType_new" RENAME TO "ProjectType";

-- New enums
CREATE TYPE "TimingMode" AS ENUM ('MINUTES', 'PAGES');
CREATE TYPE "SceneResourceCategory" AS ENUM ('EXTRAS', 'GROUP', 'STUNT', 'MAKEUP', 'COSTUME', 'PROP', 'VEHICLE', 'CUSTOM');
CREATE TYPE "ShootDayType" AS ENUM ('WORKING', 'OFF', 'REST', 'PREP');
CREATE TYPE "ActorRoleType" AS ENUM ('LEAD', 'SUPPORTING', 'EPISODIC');
CREATE TYPE "ContractorType" AS ENUM ('IP', 'INDIVIDUAL', 'SELF_EMPLOYED', 'UNKNOWN');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- SceneStatus migration
CREATE TYPE "SceneStatus_new" AS ENUM ('SHOT', 'RESHOOT_REQUIRED', 'PLANNING', 'OFF_PLAN', 'NOT_SHOT');
ALTER TABLE "Scene" ADD COLUMN "status_new" "SceneStatus_new";
UPDATE "Scene" SET "status_new" = CASE
  WHEN "status"::text = 'SHOT' THEN 'SHOT'::"SceneStatus_new"
  WHEN "status"::text = 'CUT' THEN 'NOT_SHOT'::"SceneStatus_new"
  ELSE 'PLANNING'::"SceneStatus_new"
END;
ALTER TABLE "Scene" DROP COLUMN "status";
ALTER TABLE "Scene" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "Scene" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Scene" ALTER COLUMN "status" SET DEFAULT 'PLANNING';
DROP TYPE "SceneStatus";
ALTER TYPE "SceneStatus_new" RENAME TO "SceneStatus";

-- ElementType: add MAKEUP, COSTUME
ALTER TYPE "ElementType" ADD VALUE IF NOT EXISTS 'MAKEUP';
ALTER TYPE "ElementType" ADD VALUE IF NOT EXISTS 'COSTUME';

-- Project expanded settings
ALTER TABLE "Project" ADD COLUMN "fullName" TEXT;
ALTER TABLE "Project" ADD COLUMN "description" TEXT;
ALTER TABLE "Project" ADD COLUMN "episodeCount" INTEGER;
ALTER TABLE "Project" ADD COLUMN "episodeRuntimeMin" INTEGER;
ALTER TABLE "Project" ADD COLUMN "shootingDaysCount" INTEGER;
ALTER TABLE "Project" ADD COLUMN "cameraUnits" INTEGER DEFAULT 1;
ALTER TABLE "Project" ADD COLUMN "cameraCount" INTEGER DEFAULT 1;
ALTER TABLE "Project" ADD COLUMN "timingMode" "TimingMode" NOT NULL DEFAULT 'MINUTES';
ALTER TABLE "Project" ADD COLUMN "pageToMinuteRatio" DECIMAL(6,2) NOT NULL DEFAULT 1;
ALTER TABLE "Project" ADD COLUMN "shiftStartTime" TEXT DEFAULT '08:00';
ALTER TABLE "Project" ADD COLUMN "plannedDailyOutputMin" INTEGER DEFAULT 420;
ALTER TABLE "Project" ADD COLUMN "shootOnFilm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "filmType" TEXT;
ALTER TABLE "Project" ADD COLUMN "filmCoefficient" DECIMAL(6,2);
ALTER TABLE "Project" ADD COLUMN "calcCalendarDays" BOOLEAN NOT NULL DEFAULT true;

-- Custom roles table
CREATE TABLE "ProjectRoleDefinition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectRoleDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectRoleDefinition_projectId_name_key" ON "ProjectRoleDefinition"("projectId", "name");
CREATE INDEX "ProjectRoleDefinition_projectId_idx" ON "ProjectRoleDefinition"("projectId");
ALTER TABLE "ProjectRoleDefinition" ADD CONSTRAINT "ProjectRoleDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default roles per project and migrate memberships
ALTER TABLE "ProjectMembership" ADD COLUMN "roleId" TEXT;
ALTER TABLE "ProjectInvite" ADD COLUMN "roleId" TEXT;

DO $$
DECLARE
  proj RECORD;
  producer_id TEXT;
  viewer_id TEXT;
  full_perms JSONB := '{"scenes":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"script_import":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"schedule":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"post_edit_timing":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"actors":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"characters":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"locations":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"elements":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"budget":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"reports":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"finance":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"post":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"members":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true},"project_settings":{"access":true,"read":true,"create":true,"update":true,"delete":true,"financeRead":true,"financeWrite":true}}'::jsonb;
  viewer_perms JSONB := '{"scenes":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"script_import":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"schedule":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"post_edit_timing":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"actors":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":true,"financeWrite":false},"characters":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"locations":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"elements":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"budget":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":true,"financeWrite":false},"reports":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"finance":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":true,"financeWrite":false},"post":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"members":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false},"project_settings":{"access":true,"read":true,"create":false,"update":false,"delete":false,"financeRead":false,"financeWrite":false}}'::jsonb;
BEGIN
  FOR proj IN SELECT DISTINCT "projectId" FROM "ProjectMembership" UNION SELECT DISTINCT "projectId" FROM "ProjectInvite" UNION SELECT "id" AS "projectId" FROM "Project"
  LOOP
    producer_id := 'role_' || substr(md5(proj."projectId" || '_producer'), 1, 24);
    viewer_id := 'role_' || substr(md5(proj."projectId" || '_viewer'), 1, 24);

    INSERT INTO "ProjectRoleDefinition" ("id", "projectId", "name", "note", "isSystem", "permissions", "updatedAt")
    VALUES (producer_id, proj."projectId", 'Продюсер', 'Полный доступ', true, full_perms, NOW())
    ON CONFLICT DO NOTHING;

    INSERT INTO "ProjectRoleDefinition" ("id", "projectId", "name", "note", "isSystem", "permissions", "updatedAt")
    VALUES (viewer_id, proj."projectId", 'Наблюдатель', 'Только просмотр', true, viewer_perms, NOW())
    ON CONFLICT DO NOTHING;

    UPDATE "ProjectMembership" SET "roleId" = producer_id
    WHERE "projectId" = proj."projectId" AND "role"::text IN ('PRODUCER', 'AD_2ND', 'COORDINATOR');

    UPDATE "ProjectMembership" SET "roleId" = viewer_id
    WHERE "projectId" = proj."projectId" AND "roleId" IS NULL;

    UPDATE "ProjectInvite" SET "roleId" = producer_id
    WHERE "projectId" = proj."projectId" AND "role"::text IN ('PRODUCER', 'AD_2ND', 'COORDINATOR');

    UPDATE "ProjectInvite" SET "roleId" = viewer_id
    WHERE "projectId" = proj."projectId" AND "roleId" IS NULL;
  END LOOP;
END $$;

ALTER TABLE "ProjectMembership" DROP COLUMN "role";
ALTER TABLE "ProjectMembership" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ProjectRoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectInvite" DROP COLUMN "role";
ALTER TABLE "ProjectInvite" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ProjectRoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE "ProjectRole";

-- Scene expansion
ALTER TABLE "Scene" DROP CONSTRAINT IF EXISTS "Scene_projectId_number_key";
ALTER TABLE "Scene" DROP COLUMN IF EXISTS "estimatedDurationMin";

ALTER TABLE "Scene" ADD COLUMN "episodeNumber" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scene" ADD COLUMN "postfix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Scene" ADD COLUMN "summary" TEXT;
ALTER TABLE "Scene" ADD COLUMN "scriptContent" TEXT;
ALTER TABLE "Scene" ADD COLUMN "scriptDay" INTEGER;
ALTER TABLE "Scene" ADD COLUMN "objectType" TEXT;
ALTER TABLE "Scene" ADD COLUMN "planSeconds" INTEGER;
ALTER TABLE "Scene" ADD COLUMN "factSeconds" INTEGER;
ALTER TABLE "Scene" ADD COLUMN "preEditSeconds" INTEGER;
ALTER TABLE "Scene" ADD COLUMN "editSeconds" INTEGER;
ALTER TABLE "Scene" ADD COLUMN "filmFootagePlan" DECIMAL(10,2);
ALTER TABLE "Scene" ADD COLUMN "filmFootageFact" DECIMAL(10,2);
ALTER TABLE "Scene" ADD COLUMN "statusDate" TIMESTAMP(3);

CREATE UNIQUE INDEX "Scene_projectId_episodeNumber_number_postfix_key" ON "Scene"("projectId", "episodeNumber", "number", "postfix");

-- Location objectType
ALTER TABLE "Location" ADD COLUMN "objectType" TEXT;

-- SceneResource
CREATE TABLE "SceneResource" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "category" "SceneResourceCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "SceneResource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SceneResource_sceneId_idx" ON "SceneResource"("sceneId");
ALTER TABLE "SceneResource" ADD CONSTRAINT "SceneResource_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ShootDay expansion
ALTER TABLE "ShootDay" ADD COLUMN "dayType" "ShootDayType" NOT NULL DEFAULT 'WORKING';
ALTER TABLE "ShootDay" ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShootDay" ADD COLUMN "isNightShift" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShootDay" ADD COLUMN "comment" TEXT;

-- Actors
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "characterId" TEXT,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT,
    "middleName" TEXT,
    "gender" "Gender",
    "contractorType" "ContractorType" NOT NULL DEFAULT 'UNKNOWN',
    "roleType" "ActorRoleType" NOT NULL DEFAULT 'SUPPORTING',
    "phone1" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "carPickupTime" TEXT,
    "arrivalTime" TEXT,
    "tags" TEXT,
    "specialConditions" TEXT,
    "shiftRate" DECIMAL(12,2),
    "shiftHoursMin" INTEGER,
    "unpaidOvertimeMin" INTEGER,
    "forceMajeurePct" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Actor_projectId_idx" ON "Actor"("projectId");
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ActorOvertimeRate" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "hourNumber" INTEGER NOT NULL,
    "percentRate" DECIMAL(6,2),
    "amount" DECIMAL(12,2),
    "forceMajeurePct" DECIMAL(6,2),
    "forceMajeureAmt" DECIMAL(12,2),
    "totalWithFk" DECIMAL(12,2),
    CONSTRAINT "ActorOvertimeRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActorOvertimeRate_actorId_hourNumber_key" ON "ActorOvertimeRate"("actorId", "hourNumber");
ALTER TABLE "ActorOvertimeRate" ADD CONSTRAINT "ActorOvertimeRate_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActorExtraPayment" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "amount" DECIMAL(12,2) NOT NULL,
    "forceMajeurePct" DECIMAL(6,2),
    "forceMajeureAmt" DECIMAL(12,2),
    "totalWithFk" DECIMAL(12,2),
    "description" TEXT,
    CONSTRAINT "ActorExtraPayment_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ActorExtraPayment" ADD CONSTRAINT "ActorExtraPayment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit log
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "summary" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Script import jobs
CREATE TABLE "ScriptImportJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "timingMethod" TEXT,
    "showComparison" BOOLEAN NOT NULL DEFAULT true,
    "previewData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScriptImportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScriptImportJob_projectId_idx" ON "ScriptImportJob"("projectId");
