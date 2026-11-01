-- AlterTable
ALTER TABLE "ResourceCategory" ADD COLUMN     "callSheetSectionId" TEXT;

-- AddForeignKey
ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_callSheetSectionId_fkey" FOREIGN KEY ("callSheetSectionId") REFERENCES "CallSheetSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Данные (один раз): раздел вызывного для существующих категорий — только точное совпадение
-- названия (без регистра, «ё» = «е», лишние пробелы не важны), посменные — без раздела.
-- Список — тот же, что CATEGORY_DEFAULT_NAMES в src/features/call-sheets/lib/sections.ts.
CREATE TEMP TABLE "_category_section_defaults" ("name" TEXT NOT NULL, "key" TEXT NOT NULL);
INSERT INTO "_category_section_defaults" ("name", "key") VALUES
  ('групповка', 'GROUP'),
  ('массовка', 'GROUP'),
  ('групповка и массовка', 'GROUP'),
  ('массовка и групповка', 'GROUP'),
  ('игровой транспорт', 'GAME_TRANSPORT'),
  ('игровые машины', 'GAME_TRANSPORT'),
  ('реквизит', 'PROPS'),
  ('игровой реквизит', 'PROPS'),
  ('костюм', 'COSTUME'),
  ('костюмы', 'COSTUME'),
  ('трюки', 'STUNTS'),
  ('трюк', 'STUNTS'),
  ('каскадеры', 'STUNTS'),
  ('опер. техника', 'CAMERA'),
  ('операторская техника', 'CAMERA'),
  ('опер техника', 'CAMERA'),
  ('cg', 'CG'),
  ('графика', 'CG'),
  ('компьютерная графика', 'CG');

CREATE TEMP TABLE "_category_section_mapped" AS
SELECT c."id", c."projectId", d."key"
FROM "ResourceCategory" c
JOIN "_category_section_defaults" d
  ON btrim(regexp_replace(replace(lower(c."name"), 'ё', 'е'), '\s+', ' ', 'g')) = d."name"
WHERE c."perShift" = false;

-- Системные разделы проекта, если их ещё нет (как ensureCallSheetSections, тот же порядок).
INSERT INTO "CallSheetSection" ("id", "projectId", "key", "name", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."projectId", s."key", s."name", s."sortOrder", now(), now()
FROM (SELECT DISTINCT "projectId" FROM "_category_section_mapped") p
CROSS JOIN (VALUES
  ('GROUP', 'Групповка', 0),
  ('GAME_TRANSPORT', 'Игровой транспорт', 1),
  ('PROPS', 'Реквизит', 2),
  ('COSTUME', 'Костюм', 3),
  ('STUNTS', 'Трюки', 4),
  ('CAMERA', 'Опер. техника', 5),
  ('CG', 'CG', 6),
  ('SPECIAL_TRANSPORT', 'Спецтранспорт', 7),
  ('OTHER', 'Прочее', 8)
) AS s("key", "name", "sortOrder")
ON CONFLICT ("projectId", "key") DO NOTHING;

UPDATE "ResourceCategory" c
SET "callSheetSectionId" = cs."id"
FROM "_category_section_mapped" m
JOIN "CallSheetSection" cs ON cs."projectId" = m."projectId" AND cs."key" = m."key"
WHERE c."id" = m."id";

DROP TABLE "_category_section_mapped";
DROP TABLE "_category_section_defaults";
