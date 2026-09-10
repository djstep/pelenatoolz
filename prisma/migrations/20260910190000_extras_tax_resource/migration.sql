-- Resource catalog extras + tax fields on production-report work extras

CREATE TABLE IF NOT EXISTS "ResourceExtraPayment" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "paymentDate" TIMESTAMP(3),
  "amount" DECIMAL(12,2) NOT NULL,
  "taxPercent" DECIMAL(6,2),
  "taxAmount" DECIMAL(12,2),
  "totalWithTax" DECIMAL(12,2),
  "description" TEXT,
  CONSTRAINT "ResourceExtraPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ResourceExtraPayment_itemId_idx" ON "ResourceExtraPayment"("itemId");

DO $$ BEGIN
  ALTER TABLE "ResourceExtraPayment"
    ADD CONSTRAINT "ResourceExtraPayment_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "ResourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ProductionReportWorkExtra"
  ADD COLUMN IF NOT EXISTS "taxPercent" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "totalWithTax" DECIMAL(14,2);

UPDATE "ProductionReportWorkExtra"
SET "totalWithTax" = "amount"
WHERE "totalWithTax" IS NULL;
