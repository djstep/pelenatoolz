-- Название цеха в приглашении (на момент создания). Цех удалят до принятия — поле departmentId
-- очистится, а по названию в журнал запишется «вступил без цеха: цех «…» удалён».
-- Необязательное поле; старым приглашениям заполняется из их цеха. Других данных не меняет.

-- AlterTable
ALTER TABLE "ProjectInvite" ADD COLUMN     "departmentName" TEXT;

-- Data
UPDATE "ProjectInvite" AS i
SET "departmentName" = d."name"
FROM "Department" AS d
WHERE d."id" = i."departmentId"
  AND i."departmentName" IS NULL;
