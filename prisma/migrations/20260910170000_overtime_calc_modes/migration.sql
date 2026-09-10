-- Overtime calculation modes and extended financial terms

CREATE TYPE "OvertimeCalcMode" AS ENUM ('HALF_HOUR', 'HOURLY_CUMULATIVE', 'HOURLY_FLAT');
CREATE TYPE "UnpaidOvertimeMode" AS ENUM ('FIRST_HOUR', 'EACH_HOUR');

ALTER TABLE "Actor"
  ADD COLUMN IF NOT EXISTS "overtimeMode" "OvertimeCalcMode" NOT NULL DEFAULT 'HOURLY_CUMULATIVE',
  ADD COLUMN IF NOT EXISTS "unpaidOvertimeMode" "UnpaidOvertimeMode" NOT NULL DEFAULT 'FIRST_HOUR';

ALTER TABLE "ResourceItem"
  ADD COLUMN IF NOT EXISTS "taxPercent" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "overtimeMode" "OvertimeCalcMode" NOT NULL DEFAULT 'HOURLY_CUMULATIVE',
  ADD COLUMN IF NOT EXISTS "unpaidOvertimeMode" "UnpaidOvertimeMode" NOT NULL DEFAULT 'FIRST_HOUR';

CREATE TABLE IF NOT EXISTS "ResourceOvertimeRate" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "hourNumber" INTEGER NOT NULL,
  "percentRate" DECIMAL(6,2),
  "amount" DECIMAL(12,2),
  "taxPercent" DECIMAL(6,2),
  "taxAmount" DECIMAL(12,2),
  "totalWithTax" DECIMAL(12,2),
  CONSTRAINT "ResourceOvertimeRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ResourceOvertimeRate_itemId_hourNumber_key"
  ON "ResourceOvertimeRate"("itemId", "hourNumber");

ALTER TABLE "ResourceOvertimeRate"
  DROP CONSTRAINT IF EXISTS "ResourceOvertimeRate_itemId_fkey";
ALTER TABLE "ResourceOvertimeRate"
  ADD CONSTRAINT "ResourceOvertimeRate_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ResourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Location"
  ADD COLUMN IF NOT EXISTS "shiftRate" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "shiftHoursMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "unpaidOvertimeMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxPercent" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "overtimeMode" "OvertimeCalcMode" NOT NULL DEFAULT 'HOURLY_CUMULATIVE',
  ADD COLUMN IF NOT EXISTS "unpaidOvertimeMode" "UnpaidOvertimeMode" NOT NULL DEFAULT 'FIRST_HOUR';

CREATE TABLE IF NOT EXISTS "LocationOvertimeRate" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "hourNumber" INTEGER NOT NULL,
  "percentRate" DECIMAL(6,2),
  "amount" DECIMAL(12,2),
  "taxPercent" DECIMAL(6,2),
  "taxAmount" DECIMAL(12,2),
  "totalWithTax" DECIMAL(12,2),
  CONSTRAINT "LocationOvertimeRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LocationOvertimeRate_locationId_hourNumber_key"
  ON "LocationOvertimeRate"("locationId", "hourNumber");

ALTER TABLE "LocationOvertimeRate"
  DROP CONSTRAINT IF EXISTS "LocationOvertimeRate_locationId_fkey";
ALTER TABLE "LocationOvertimeRate"
  ADD CONSTRAINT "LocationOvertimeRate_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionReportWorkRow"
  ADD COLUMN IF NOT EXISTS "overtimeMode" "OvertimeCalcMode",
  ADD COLUMN IF NOT EXISTS "unpaidOvertimeMode" "UnpaidOvertimeMode";
