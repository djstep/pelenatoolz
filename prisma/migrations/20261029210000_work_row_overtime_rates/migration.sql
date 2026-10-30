-- Волна 2, шаг 4: почасовые ставки переработки хранятся в строке отчёта смены (снимок),
-- как ставка смены, налог и режимы. Меняются только при «Обновить из КПП» с галочкой
-- «Обновить ставки из карточек».
--
-- Существующим строкам — из карточек по тем же правилам, по которым оплата считалась до этого:
-- есть актёр — его таблица (даже пустая), иначе позиция ресурса, иначе объект; спецтранспорт — пусто.
-- Значения те же, что в карточках, поэтому оплата и начисления не меняются.

-- AlterTable
ALTER TABLE "ProductionReportWorkRow" ADD COLUMN     "overtimeRates" JSONB NOT NULL DEFAULT '[]';


UPDATE "ProductionReportWorkRow" AS r
SET "overtimeRates" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'hourNumber', o."hourNumber",
    'percentRate', o."percentRate",
    'amount', o."amount",
    'taxPercent', o."taxPercent"
  ) ORDER BY o."hourNumber")
  FROM "ActorOvertimeRate" AS o
  WHERE o."actorId" = r."actorId"
), '[]'::jsonb)
WHERE r."actorId" IS NOT NULL;

UPDATE "ProductionReportWorkRow" AS r
SET "overtimeRates" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'hourNumber', o."hourNumber",
    'percentRate', o."percentRate",
    'amount', o."amount",
    'taxPercent', o."taxPercent"
  ) ORDER BY o."hourNumber")
  FROM "ResourceOvertimeRate" AS o
  WHERE o."itemId" = r."resourceItemId"
), '[]'::jsonb)
WHERE r."actorId" IS NULL AND r."resourceItemId" IS NOT NULL;

UPDATE "ProductionReportWorkRow" AS r
SET "overtimeRates" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'hourNumber', o."hourNumber",
    'percentRate', o."percentRate",
    'amount', o."amount",
    'taxPercent', o."taxPercent"
  ) ORDER BY o."hourNumber")
  FROM "LocationOvertimeRate" AS o
  WHERE o."locationId" = r."locationId"
), '[]'::jsonb)
WHERE r."actorId" IS NULL AND r."resourceItemId" IS NULL AND r."locationId" IS NOT NULL;
