-- Статус «Резерв» для кандидатов кастинга: запасной вариант на роль.
-- Только добавляет значение, существующие записи не меняются.
ALTER TYPE "CastingCandidateStatus" ADD VALUE IF NOT EXISTS 'RESERVE' AFTER 'APPROVED';
