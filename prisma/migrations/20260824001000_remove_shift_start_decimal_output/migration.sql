-- Drop shift start time and allow decimal planned daily output from zero
ALTER TABLE "Project" DROP COLUMN IF EXISTS "shiftStartTime";

ALTER TABLE "Project"
  ALTER COLUMN "plannedDailyOutputMin" TYPE DECIMAL(8, 2)
  USING "plannedDailyOutputMin"::decimal;

ALTER TABLE "Project"
  ALTER COLUMN "plannedDailyOutputMin" DROP DEFAULT;
