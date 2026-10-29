-- Раздел «Сметы — просмотр всех» (smeta_all) в матрице прав ролей (JSON в "ProjectRoleDefinition"."permissions").
-- Схема не меняется, дописываются только данные.
--
-- В разделе есть только «Доступ» и «Просмотр»; остальные флаги всегда выключены.
-- Всем ролям раздел выключен, системному «Продюсеру» включён (как в шаблоне новых проектов).
-- Роли, где раздел уже есть, не трогаются — миграцию можно применить повторно без вреда.

UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = r."permissions" || jsonb_build_object(
  'smeta_all',
  jsonb_build_object(
    'access', r."isSystem" AND r."name" = 'Продюсер',
    'read', r."isSystem" AND r."name" = 'Продюсер',
    'create', false,
    'update', false,
    'delete', false,
    'financeRead', false,
    'financeWrite', false,
    'financeUnlock', false
  )
)
WHERE jsonb_typeof(r."permissions") = 'object'
  AND r."permissions"->'smeta_all' IS NULL;
