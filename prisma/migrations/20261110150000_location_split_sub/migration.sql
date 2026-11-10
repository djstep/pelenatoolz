-- Объекты и подобъекты, шаг 2.
-- Родитель — только из того же проекта (составной ключ), ссылка на себя запрещена.
-- Старые записи «объект + подобъект одной строкой» (name + sublocation) становятся деревом:
-- подобъект = строка с parentId объекта и name подобъекта. Id строк не меняются, поэтому сцены,
-- отчёты смены, скаут, вызывные, словарь и календарь остаются привязаны к тем же строкам.
-- Адреса и ставки подобъектов не трогаются. Повторный запуск данных ничего не меняет.

-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_parentId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Location_id_projectId_key" ON "Location"("id", "projectId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_projectId_fkey" FOREIGN KEY ("parentId", "projectId") REFERENCES "Location"("id", "projectId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Ссылка на себя
ALTER TABLE "Location" ADD CONSTRAINT "Location_parent_not_self" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- 1. Пустой подобъект — это объект без подобъекта.
UPDATE "Location"
SET "sublocation" = NULL
WHERE "sublocation" IS NOT NULL AND btrim("sublocation") = '';

-- 2. Строка объекта для групп с подобъектами, где её нет. Ключ группы — как у импорта:
--    пробелы схлопнуты, верхний регистр, Ё = Е. Тип и адрес — только если у всех подобъектов один.
INSERT INTO "Location" ("id", "projectId", "name", "locationKind", "address", "createdAt", "updatedAt")
SELECT
  'locobj' || substr(md5(g."projectId" || '|' || g.key), 1, 19),
  g."projectId",
  g.name,
  g.kind,
  g.address,
  now(),
  now()
FROM (
  SELECT
    "projectId",
    replace(upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')), 'Ё', 'Е') AS key,
    (array_agg(regexp_replace(btrim("name"), '\s+', ' ', 'g') ORDER BY "createdAt", "id"))[1] AS name,
    CASE
      WHEN count(DISTINCT "locationKind") = 1 AND count("locationKind") = count(*)
        THEN (min("locationKind"::text))::"LocationKind"
    END AS kind,
    CASE
      WHEN count(DISTINCT btrim("address")) = 1
        AND count(*) FILTER (WHERE btrim(coalesce("address", '')) <> '') = count(*)
        THEN min(btrim("address"))
    END AS address
  FROM "Location"
  WHERE "parentId" IS NULL AND "sublocation" IS NOT NULL
  GROUP BY 1, 2
) g
WHERE NOT EXISTS (
  SELECT 1
  FROM "Location" o
  WHERE o."projectId" = g."projectId"
    AND o."parentId" IS NULL
    AND o."sublocation" IS NULL
    AND replace(upper(regexp_replace(btrim(o."name"), '\s+', ' ', 'g')), 'Ё', 'Е') = g.key
);

-- 3. Подобъекты — к объекту своей группы (если строк объекта несколько — к самой ранней).
WITH obj AS (
  SELECT DISTINCT ON ("projectId", key) "id", "projectId", key
  FROM (
    SELECT
      "id",
      "projectId",
      "createdAt",
      replace(upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')), 'Ё', 'Е') AS key
    FROM "Location"
    WHERE "parentId" IS NULL AND "sublocation" IS NULL
  ) t
  ORDER BY "projectId", key, "createdAt", "id"
)
UPDATE "Location" s
SET "parentId" = obj."id",
    "name" = regexp_replace(btrim(s."sublocation"), '\s+', ' ', 'g'),
    "sublocation" = NULL
FROM obj
WHERE s."parentId" IS NULL
  AND s."sublocation" IS NOT NULL
  AND obj."projectId" = s."projectId"
  AND obj.key = replace(upper(regexp_replace(btrim(s."name"), '\s+', ' ', 'g')), 'Ё', 'Е');

-- 4. Порядок подобъектов внутри объекта — по алфавиту (только у ещё не упорядоченных).
UPDATE "Location" l
SET "sortOrder" = r.n
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "parentId" ORDER BY upper("name"), "createdAt", "id") AS n
  FROM "Location"
  WHERE "parentId" IS NOT NULL
) r
WHERE l."id" = r."id" AND l."sortOrder" = 0;
