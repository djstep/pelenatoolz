-- Mileage (km) for vehicle / special transport resources

ALTER TABLE "ResourceCategory"
  ADD COLUMN IF NOT EXISTS "tracksMileage" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ResourceItem"
  ADD COLUMN IF NOT EXISTS "kmRate" DECIMAL(12,2);

ALTER TABLE "ShootDayTransport"
  ADD COLUMN IF NOT EXISTS "kmRate" DECIMAL(12,2);

ALTER TABLE "ProductionReportWorkRow"
  ADD COLUMN IF NOT EXISTS "tracksMileage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "factKm" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "kmRate" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "mileagePay" DECIMAL(14,2);
