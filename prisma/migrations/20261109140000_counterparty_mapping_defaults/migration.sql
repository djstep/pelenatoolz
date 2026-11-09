-- Налог по умолчанию в договоре и акте (решение владельца 9 ноября 2026): у юрлица и физлица (ГПХ)
-- налог уже в итоговой стоимости — по умолчанию выключен. Сопоставление «тип контрагента → форма»
-- для них снимается. Форма «ГПХ» остаётся, процента у неё нет.
-- Миграция идёт сразу за `smeta_items`, поэтому снимает только сопоставления, которые та поставила.
DELETE FROM "ProjectCounterpartyPaymentForm" AS m
USING "ProjectPaymentForm" AS f
WHERE m."paymentFormId" = f."id"
  AND f."isSystem" = true
  AND (m."counterpartyType"::text, f."key") IN (
    VALUES
      ('LEGAL_ENTITY', 'LEGAL_ENTITY'),
      ('INDIVIDUAL', 'GPH')
  );
