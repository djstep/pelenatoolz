-- AlterTable
ALTER TABLE "Character" ADD COLUMN "roleType" "ActorRoleType";

-- AlterTable
ALTER TABLE "CastingCandidate" ADD COLUMN "rating" INTEGER;

-- CreateTable
CREATE TABLE "AuditionSchedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditionScheduleCandidate" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "castingCandidateId" TEXT NOT NULL,

    CONSTRAINT "AuditionScheduleCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditionSchedule_projectId_date_idx" ON "AuditionSchedule"("projectId", "date");

-- CreateIndex
CREATE INDEX "AuditionScheduleCandidate_castingCandidateId_idx" ON "AuditionScheduleCandidate"("castingCandidateId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditionScheduleCandidate_scheduleId_castingCandidateId_key" ON "AuditionScheduleCandidate"("scheduleId", "castingCandidateId");

-- AddForeignKey
ALTER TABLE "AuditionSchedule" ADD CONSTRAINT "AuditionSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditionScheduleCandidate" ADD CONSTRAINT "AuditionScheduleCandidate_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AuditionSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditionScheduleCandidate" ADD CONSTRAINT "AuditionScheduleCandidate_castingCandidateId_fkey" FOREIGN KEY ("castingCandidateId") REFERENCES "CastingCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
