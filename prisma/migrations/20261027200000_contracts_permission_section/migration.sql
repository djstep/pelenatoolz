-- Раздел «Договоры и акты» в матрице прав ролей (JSON в "ProjectRoleDefinition"."permissions").
-- Схема не меняется, дописываются только данные.
--
-- Раньше договоры и акты открывались по правам раздела «Финансы»:
--   просмотр  = «Доступ» и («Фин. условия: просмотр» или «Фин. условия: редактирование»);
--   изменение = «Доступ» и («Создание» или «Редактирование» или «Удаление»).
-- Новый раздел заполняется так, чтобы роли ничего не потеряли и не получили лишнего:
--   «Доступ»   = был просмотр или изменение;
--   «Просмотр» = был просмотр;
--   «Создание» / «Редактирование» / «Удаление» = те же флаги «Финансов» при включённом «Доступе».
-- Системный «Продюсер» получает раздел целиком, как в шаблоне новых проектов.
-- Роли, где раздел уже есть, не трогаются — миграцию можно применить повторно без вреда.

WITH finance AS (
  SELECT
    "id",
    "isSystem",
    "name",
    COALESCE("permissions"->'finance'->>'access' = 'true', false)       AS access,
    COALESCE("permissions"->'finance'->>'create' = 'true', false)       AS can_create,
    COALESCE("permissions"->'finance'->>'update' = 'true', false)       AS can_update,
    COALESCE("permissions"->'finance'->>'delete' = 'true', false)       AS can_delete,
    COALESCE("permissions"->'finance'->>'financeRead' = 'true', false)  AS fin_read,
    COALESCE("permissions"->'finance'->>'financeWrite' = 'true', false) AS fin_write
  FROM "ProjectRoleDefinition"
  WHERE jsonb_typeof("permissions") = 'object'
    AND "permissions"->'contracts' IS NULL
),
derived AS (
  SELECT
    "id",
    "isSystem",
    "name",
    access,
    can_create,
    can_update,
    can_delete,
    (access AND (fin_read OR fin_write))                  AS can_view,
    (access AND (can_create OR can_update OR can_delete)) AS can_edit
  FROM finance
)
UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = r."permissions" || jsonb_build_object(
  'contracts',
  CASE
    WHEN d."isSystem" AND d."name" = 'Продюсер' THEN jsonb_build_object(
      'access', true,
      'read', true,
      'create', true,
      'update', true,
      'delete', true,
      'financeRead', true,
      'financeWrite', true,
      'financeUnlock', true
    )
    ELSE jsonb_build_object(
      'access', d.can_view OR d.can_edit,
      'read', d.can_view,
      'create', d.access AND d.can_create,
      'update', d.access AND d.can_update,
      'delete', d.access AND d.can_delete,
      'financeRead', false,
      'financeWrite', false,
      'financeUnlock', false
    )
  END
)
FROM derived AS d
WHERE r."id" = d."id";
