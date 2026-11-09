-- Проценты налога форм оплаты по умолчанию (решение владельца 9 ноября 2026):
-- у самозанятого и ИП — 6%, у ГПХ, наличных и юрлица процента по умолчанию нет (пусто, не 0):
-- при выборе такой формы налог вводится руками.
-- Миграция идёт сразу за `smeta_items`, поэтому трогает только значения, которые та поставила.
UPDATE "ProjectPaymentForm"
SET "defaultTaxPercent" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isSystem" = true
  AND ("key", "defaultTaxPercent") IN (
    VALUES
      ('GPH', 13::numeric),
      ('CASH', 0::numeric),
      ('LEGAL_ENTITY', 0::numeric)
  );
