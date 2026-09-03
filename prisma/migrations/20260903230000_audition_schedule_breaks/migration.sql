-- CreateTable
CREATE TABLE "AuditionScheduleBreak" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "duration" TEXT NOT NULL DEFAULT '01:00',
    "slotType" "TimeSlotType" NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditionScheduleBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditionScheduleBreak_projectId_date_idx" ON "AuditionScheduleBreak"("projectId", "date");

-- AddForeignKey
ALTER TABLE "AuditionScheduleBreak" ADD CONSTRAINT "AuditionScheduleBreak_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
