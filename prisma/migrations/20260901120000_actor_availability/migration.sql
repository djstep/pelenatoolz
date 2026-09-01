-- CreateEnum
CREATE TYPE "ActorAvailabilityStatus" AS ENUM ('UNSET', 'FREE', 'BUSY_OTHER', 'BUSY_OUR_PROJECT', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "ActorAvailabilityRow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT,
    "castingPersonId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActorAvailabilityRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActorAvailabilityDay" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ActorAvailabilityStatus" NOT NULL DEFAULT 'UNSET',
    "comment" TEXT,

    CONSTRAINT "ActorAvailabilityDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActorAvailabilityRow_projectId_actorId_key" ON "ActorAvailabilityRow"("projectId", "actorId");
CREATE UNIQUE INDEX "ActorAvailabilityRow_projectId_castingPersonId_key" ON "ActorAvailabilityRow"("projectId", "castingPersonId");
CREATE INDEX "ActorAvailabilityRow_projectId_sortOrder_idx" ON "ActorAvailabilityRow"("projectId", "sortOrder");

CREATE UNIQUE INDEX "ActorAvailabilityDay_rowId_date_key" ON "ActorAvailabilityDay"("rowId", "date");
CREATE INDEX "ActorAvailabilityDay_date_idx" ON "ActorAvailabilityDay"("date");

-- AddForeignKey
ALTER TABLE "ActorAvailabilityRow" ADD CONSTRAINT "ActorAvailabilityRow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActorAvailabilityRow" ADD CONSTRAINT "ActorAvailabilityRow_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActorAvailabilityRow" ADD CONSTRAINT "ActorAvailabilityRow_castingPersonId_fkey" FOREIGN KEY ("castingPersonId") REFERENCES "CastingPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActorAvailabilityDay" ADD CONSTRAINT "ActorAvailabilityDay_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ActorAvailabilityRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
