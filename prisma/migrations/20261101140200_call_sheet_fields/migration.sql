-- CreateEnum
CREATE TYPE "CallSheetUnit" AS ENUM ('MAIN', 'SECOND');

-- CreateEnum
CREATE TYPE "ActorTransportMode" AS ENUM ('CAR', 'SELF', 'CUSTOM');

-- AlterEnum
ALTER TYPE "TimeSlotType" ADD VALUE 'PREP';

-- AlterTable
ALTER TABLE "CallSheet" ADD COLUMN     "actorRestrictions" TEXT,
ADD COLUMN     "importantNote" TEXT,
ADD COLUMN     "schemeLocationId" TEXT,
ADD COLUMN     "tempDay" TEXT,
ADD COLUMN     "tempNight" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "directions" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "onSiteNotes" TEXT,
ADD COLUMN     "parking" TEXT;

-- AlterTable
ALTER TABLE "ProductionReportWorkRow" ADD COLUMN     "budgetItemId" TEXT;

-- AlterTable
ALTER TABLE "ShootDayActorCall" ADD COLUMN     "transportMode" "ActorTransportMode",
ADD COLUMN     "transportText" TEXT;

-- AlterTable
ALTER TABLE "ShootDayTimeSlot" ADD COLUMN     "customLabel" TEXT,
ADD COLUMN     "isContinuation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unit" "CallSheetUnit" NOT NULL DEFAULT 'MAIN';

-- AlterTable
ALTER TABLE "ShootDayTransport" ADD COLUMN     "budgetItemId" TEXT,
ADD COLUMN     "scenes" TEXT,
ADD COLUMN     "wrapTime" TEXT;

-- CreateTable
CREATE TABLE "LocationPoint" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetSection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetElement" (
    "id" TEXT NOT NULL,
    "callSheetId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "autoKey" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "scenes" TEXT,
    "arrivalTime" TEXT,
    "readyTime" TEXT,
    "wrapTime" TEXT,
    "notes" TEXT,
    "secondUnit" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetElement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationPoint_locationId_sortOrder_idx" ON "LocationPoint"("locationId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallSheetSection_projectId_sortOrder_idx" ON "CallSheetSection"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetSection_projectId_key_key" ON "CallSheetSection"("projectId", "key");

-- CreateIndex
CREATE INDEX "CallSheetElement_callSheetId_sortOrder_idx" ON "CallSheetElement"("callSheetId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallSheetElement_sectionId_idx" ON "CallSheetElement"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetElement_callSheetId_autoKey_key" ON "CallSheetElement"("callSheetId", "autoKey");

-- CreateIndex
CREATE INDEX "ShootDayTransport_budgetItemId_idx" ON "ShootDayTransport"("budgetItemId");

-- AddForeignKey
ALTER TABLE "LocationPoint" ADD CONSTRAINT "LocationPoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheet" ADD CONSTRAINT "CallSheet_schemeLocationId_fkey" FOREIGN KEY ("schemeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetSection" ADD CONSTRAINT "CallSheetSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetElement" ADD CONSTRAINT "CallSheetElement_callSheetId_fkey" FOREIGN KEY ("callSheetId") REFERENCES "CallSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetElement" ADD CONSTRAINT "CallSheetElement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CallSheetSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootDayTransport" ADD CONSTRAINT "ShootDayTransport_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReportWorkRow" ADD CONSTRAINT "ProductionReportWorkRow_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
