-- Волна 2в, шаг 1: владелец проекта.
-- Поле заполняется общим правилом, без зашитых id:
--   1) создатель проекта, если он сейчас активный участник с системной ролью «Продюсер»;
--   2) иначе самый ранний по дате вступления активный участник с системной ролью «Продюсер».
-- Проект, которому владельца не нашлось, останавливает миграцию — поле обязательное.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "ownerUserId" TEXT;

-- Backfill: создатель-продюсер
UPDATE "Project" p
SET "ownerUserId" = p."createdById"
WHERE EXISTS (
  SELECT 1
  FROM "ProjectMembership" m
  JOIN "ProjectRoleDefinition" r ON r."id" = m."roleId"
  WHERE m."projectId" = p."id"
    AND m."userId" = p."createdById"
    AND m."status" = 'ACTIVE'
    AND r."isSystem" = true
    AND r."name" = 'Продюсер'
);

-- Backfill: самый ранний активный продюсер
UPDATE "Project" p
SET "ownerUserId" = (
  SELECT m."userId"
  FROM "ProjectMembership" m
  JOIN "ProjectRoleDefinition" r ON r."id" = m."roleId"
  WHERE m."projectId" = p."id"
    AND m."status" = 'ACTIVE'
    AND r."isSystem" = true
    AND r."name" = 'Продюсер'
  ORDER BY m."createdAt" ASC, m."id" ASC
  LIMIT 1
)
WHERE p."ownerUserId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "ownerUserId" IS NULL) THEN
    RAISE EXCEPTION 'project_owner: у проекта нет активного продюсера — владельца не назначить';
  END IF;
END $$;

ALTER TABLE "Project" ALTER COLUMN "ownerUserId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Project_ownerUserId_idx" ON "Project"("ownerUserId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
