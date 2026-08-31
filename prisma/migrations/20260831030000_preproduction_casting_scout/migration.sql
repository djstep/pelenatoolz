-- CreateEnum
CREATE TYPE "CastingCandidateStatus" AS ENUM ('CONSIDERING', 'APPLICATION_SENT', 'CASTING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "ScoutCandidateStatus" AS ENUM ('CONSIDERING', 'NEGOTIATION', 'APPROVED', 'REJECTED');

-- AlterTable Character
ALTER TABLE "Character" ADD COLUMN "roleRequirements" TEXT;
ALTER TABLE "Character" ADD COLUMN "castSnapshot" JSONB;
ALTER TABLE "Character" ADD COLUMN "sourceCastingCandidateId" TEXT;

-- AlterTable Location
ALTER TABLE "Location" ADD COLUMN "requirementNotes" TEXT;
ALTER TABLE "Location" ADD COLUMN "scoutSnapshot" JSONB;
ALTER TABLE "Location" ADD COLUMN "sourceScoutCandidateId" TEXT;

-- CreateTable CastingPerson
CREATE TABLE "CastingPerson" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "photoUrl" TEXT,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT,
    "middleName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "agentName" TEXT,
    "agentPhone" TEXT,
    "agentEmail" TEXT,
    "physicalParams" JSONB,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposedRate" DECIMAL(12,2),
    "proposedTerms" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CastingPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable CastingCandidate
CREATE TABLE "CastingCandidate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "CastingCandidateStatus" NOT NULL DEFAULT 'CONSIDERING',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CastingCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable ScoutCandidate
CREATE TABLE "ScoutCandidate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "address" TEXT,
    "cost" DECIMAL(12,2),
    "contactName" TEXT,
    "contactPhone" TEXT,
    "photos" JSONB,
    "videos" JSONB,
    "notes" TEXT,
    "status" "ScoutCandidateStatus" NOT NULL DEFAULT 'CONSIDERING',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutCandidate_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "CastingPerson_projectId_idx" ON "CastingPerson"("projectId");
CREATE UNIQUE INDEX "CastingCandidate_characterId_personId_key" ON "CastingCandidate"("characterId", "personId");
CREATE INDEX "CastingCandidate_projectId_status_idx" ON "CastingCandidate"("projectId", "status");
CREATE INDEX "CastingCandidate_personId_idx" ON "CastingCandidate"("personId");
CREATE INDEX "ScoutCandidate_projectId_status_idx" ON "ScoutCandidate"("projectId", "status");
CREATE INDEX "ScoutCandidate_locationId_idx" ON "ScoutCandidate"("locationId");

-- Foreign keys
ALTER TABLE "CastingPerson" ADD CONSTRAINT "CastingPerson_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CastingCandidate" ADD CONSTRAINT "CastingCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CastingCandidate" ADD CONSTRAINT "CastingCandidate_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CastingCandidate" ADD CONSTRAINT "CastingCandidate_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CastingPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutCandidate" ADD CONSTRAINT "ScoutCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutCandidate" ADD CONSTRAINT "ScoutCandidate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing Actor rows with characterId → CastingPerson + APPROVED candidate + Character snapshot
DO $$
DECLARE
  actor_rec RECORD;
  person_id TEXT;
  candidate_id TEXT;
  snapshot JSONB;
BEGIN
  FOR actor_rec IN
    SELECT a.*, c."name" AS character_name
    FROM "Actor" a
    LEFT JOIN "Character" c ON c."id" = a."characterId"
    WHERE a."characterId" IS NOT NULL
  LOOP
    person_id := 'mig_person_' || actor_rec."id";
    candidate_id := 'mig_cand_' || actor_rec."id";

    INSERT INTO "CastingPerson" (
      "id", "projectId", "lastName", "firstName", "middleName",
      "phone", "email", "agentName", "agentPhone", "agentEmail",
      "proposedRate", "proposedTerms", "tags", "notes", "updatedAt"
    ) VALUES (
      person_id,
      actor_rec."projectId",
      actor_rec."lastName",
      actor_rec."firstName",
      actor_rec."middleName",
      COALESCE(actor_rec."phone1", actor_rec."phone2"),
      actor_rec."email",
      actor_rec."agentName",
      actor_rec."agentPhone",
      actor_rec."agentEmail",
      actor_rec."shiftRate",
      actor_rec."specialConditions",
      actor_rec."tags",
      NULL,
      NOW()
    ) ON CONFLICT DO NOTHING;

    INSERT INTO "CastingCandidate" (
      "id", "projectId", "characterId", "personId",
      "status", "statusChangedAt", "updatedAt"
    ) VALUES (
      candidate_id,
      actor_rec."projectId",
      actor_rec."characterId",
      person_id,
      'APPROVED',
      NOW(),
      NOW()
    ) ON CONFLICT DO NOTHING;

    snapshot := jsonb_build_object(
      'photoUrl', NULL,
      'lastName', actor_rec."lastName",
      'firstName', actor_rec."firstName",
      'middleName', actor_rec."middleName",
      'phone', COALESCE(actor_rec."phone1", actor_rec."phone2"),
      'email', actor_rec."email",
      'agentName', actor_rec."agentName",
      'agentPhone', actor_rec."agentPhone",
      'agentEmail', actor_rec."agentEmail",
      'physicalParams', '{}'::jsonb,
      'skills', '[]'::jsonb,
      'shiftRate', actor_rec."shiftRate",
      'shiftHoursMin', actor_rec."shiftHoursMin",
      'unpaidOvertimeMin', actor_rec."unpaidOvertimeMin",
      'forceMajeurePct', actor_rec."forceMajeurePct",
      'proposedRate', actor_rec."shiftRate",
      'proposedTerms', actor_rec."specialConditions",
      'riderNotes', NULL,
      'roleType', actor_rec."roleType",
      'contractorType', actor_rec."contractorType",
      'gender', actor_rec."gender",
      'approvedAt', to_jsonb(NOW())
    );

    UPDATE "Character"
    SET
      "castSnapshot" = snapshot,
      "sourceCastingCandidateId" = candidate_id,
      "updatedAt" = NOW()
    WHERE "id" = actor_rec."characterId"
      AND "castSnapshot" IS NULL;
  END LOOP;
END $$;
