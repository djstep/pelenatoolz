-- AlterTable
ALTER TABLE "ShootDay" ADD COLUMN "callSheetSavedAt" TIMESTAMP(3),
ADD COLUMN "callSheetPlanLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN "makeupOffsetMin" INTEGER,
ADD COLUMN "costumeOffsetMin" INTEGER;

-- AlterTable
ALTER TABLE "Actor" ADD COLUMN "pickupOffsetMin" INTEGER;
