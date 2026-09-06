-- Rename financial-commission (ФК / forceMajeure*) columns to tax*
ALTER TABLE "ProductionReportWorkRow" RENAME COLUMN "forceMajeurePct" TO "taxPercent";

ALTER TABLE "Actor" RENAME COLUMN "forceMajeurePct" TO "taxPercent";

ALTER TABLE "ActorOvertimeRate" RENAME COLUMN "forceMajeurePct" TO "taxPercent";
ALTER TABLE "ActorOvertimeRate" RENAME COLUMN "forceMajeureAmt" TO "taxAmount";
ALTER TABLE "ActorOvertimeRate" RENAME COLUMN "totalWithFk" TO "totalWithTax";

ALTER TABLE "ActorExtraPayment" RENAME COLUMN "forceMajeurePct" TO "taxPercent";
ALTER TABLE "ActorExtraPayment" RENAME COLUMN "forceMajeureAmt" TO "taxAmount";
ALTER TABLE "ActorExtraPayment" RENAME COLUMN "totalWithFk" TO "totalWithTax";

-- Normalize castSnapshot JSON keys: forceMajeurePct → taxPercent
UPDATE "Character"
SET "castSnapshot" = ("castSnapshot" - 'forceMajeurePct') || jsonb_build_object('taxPercent', "castSnapshot"->'forceMajeurePct')
WHERE "castSnapshot" IS NOT NULL
  AND jsonb_typeof("castSnapshot") = 'object'
  AND "castSnapshot" ? 'forceMajeurePct';
