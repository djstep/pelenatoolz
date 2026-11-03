-- Сметы на диск, шаг 3 (BUDGET_DRIVE_NOTES.md, вопрос 11): доступы к папкам смет, выданные не системой.
-- Только новые необязательные поля; существующие строки не меняются.
ALTER TABLE "DriveFolder" ADD COLUMN "foreignAccess" JSONB,
ADD COLUMN "foreignAccessCheckedAt" TIMESTAMP(3);
