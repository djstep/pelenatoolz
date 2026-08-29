-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('EXT', 'INT', 'INT_EXT', 'PAV');

-- CreateEnum
CREATE TYPE "SceneKind" AS ENUM ('SCENE', 'SOUND_DUB', 'MASTER_SHOT', 'FOOTAGE');

-- CreateEnum
CREATE TYPE "TimeSlotType" AS ENUM ('MAKEUP_COSTUME', 'REHEARSAL', 'SHOOTING', 'LUNCH', 'TRAVEL', 'IDLE');

-- CreateEnum
CREATE TYPE "CloudProvider" AS ENUM ('GOOGLE_DRIVE', 'YANDEX_DISK');

-- AlterEnum
ALTER TYPE "SceneResourceCategory" ADD VALUE 'CAMERA';

-- DropIndex
DROP INDEX "Scene_projectId_number_key";

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "objectType",
ADD COLUMN     "hasDecoration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationKind" "LocationKind",
ADD COLUMN     "sublocation" TEXT,
ADD COLUMN     "tags" TEXT;

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "montageMap" TEXT,
ADD COLUMN     "sceneKind" "SceneKind" NOT NULL DEFAULT 'SCENE',
ADD COLUMN     "shootingUnit" TEXT;

-- AlterTable
ALTER TABLE "ShootDay" ADD COLUMN     "crewMeetAddress" TEXT,
ADD COLUMN     "crewMeetTime" TEXT,
ADD COLUMN     "motorOffTime" TEXT,
ADD COLUMN     "motorOnTime" TEXT,
ADD COLUMN     "rehearsalTime" TEXT,
ADD COLUMN     "shiftNumber" INTEGER,
ADD COLUMN     "shiftStartTime" TEXT,
ADD COLUMN     "weatherNote" TEXT,
ADD COLUMN     "weatherPrecip" TEXT;

-- CreateTable
CREATE TABLE "LocationPhoto" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentCallTime" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "personName" TEXT,
    "phone" TEXT,
    "callTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DepartmentCallTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootDayTransport" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "callTime" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShootDayTransport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootDayTimeSlot" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "slotType" "TimeSlotType" NOT NULL,
    "sceneId" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShootDayTimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootDayActorCall" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "pickupTime" TEXT,
    "arrivalTime" TEXT,
    "makeupTime" TEXT,
    "costumeTime" TEXT,
    "readyTime" TEXT,
    "wrapTime" TEXT,
    "notes" TEXT,

    CONSTRAINT "ShootDayActorCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootDayResourceCall" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arrivalTime" TEXT,
    "costumeTime" TEXT,
    "makeupTime" TEXT,
    "readyTime" TEXT,
    "wrapTime" TEXT,

    CONSTRAINT "ShootDayResourceCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "accountEmail" TEXT,
    "accountLabel" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudFileLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "CloudProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "path" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "webUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudFileLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationPhoto_locationId_sortOrder_idx" ON "LocationPhoto"("locationId", "sortOrder");

-- CreateIndex
CREATE INDEX "DepartmentCallTime_shootDayId_sortOrder_idx" ON "DepartmentCallTime"("shootDayId", "sortOrder");

-- CreateIndex
CREATE INDEX "ShootDayTransport_shootDayId_sortOrder_idx" ON "ShootDayTransport"("shootDayId", "sortOrder");

-- CreateIndex
CREATE INDEX "ShootDayTimeSlot_shootDayId_sortOrder_idx" ON "ShootDayTimeSlot"("shootDayId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ShootDayActorCall_shootDayId_actorId_key" ON "ShootDayActorCall"("shootDayId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "ShootDayResourceCall_shootDayId_category_name_key" ON "ShootDayResourceCall"("shootDayId", "category", "name");

-- CreateIndex
CREATE INDEX "CloudConnection_userId_idx" ON "CloudConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CloudConnection_userId_provider_key" ON "CloudConnection"("userId", "provider");

-- CreateIndex
CREATE INDEX "CloudFileLink_projectId_createdAt_idx" ON "CloudFileLink"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CloudFileLink_connectionId_idx" ON "CloudFileLink"("connectionId");

-- AddForeignKey
ALTER TABLE "LocationPhoto" ADD CONSTRAINT "LocationPhoto_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentCallTime" ADD CONSTRAINT "DepartmentCallTime_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayTransport" ADD CONSTRAINT "ShootDayTransport_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayTimeSlot" ADD CONSTRAINT "ShootDayTimeSlot_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayTimeSlot" ADD CONSTRAINT "ShootDayTimeSlot_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayActorCall" ADD CONSTRAINT "ShootDayActorCall_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayActorCall" ADD CONSTRAINT "ShootDayActorCall_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayResourceCall" ADD CONSTRAINT "ShootDayResourceCall_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudConnection" ADD CONSTRAINT "CloudConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudFileLink" ADD CONSTRAINT "CloudFileLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudFileLink" ADD CONSTRAINT "CloudFileLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CloudConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
