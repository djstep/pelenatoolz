-- Два новых раздела-флага в матрице прав ролей (JSON в "ProjectRoleDefinition"."permissions").
-- Схема не меняется, меняются только данные.
--
-- «Сметы — вернуть на доработку» (smeta_return): раньше возвращать мог только «Продюсер».
--   Включается системному «Продюсеру» (как в шаблоне новых проектов), остальным выключен —
--   права ролей не меняются.
-- «Сметы — настройки» (smeta_settings): переменные, резерв, агентские, справочники сметы.
--   Раньше их менял «Продюсер» и любая роль с правкой «Финансов» (создание, редактирование или
--   удаление при включённом «Доступе»). Ровно этим ролям флаг и включается — каждая роль может
--   то же, что раньше. Дальше правка начислений и платежей настройки сметы не даёт.
-- Роли, где разделы уже есть, не трогаются — повторный запуск без вреда.

UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = r."permissions"
  || jsonb_build_object(
    'smeta_return',
    jsonb_build_object(
      'access', r."isSystem" AND r."name" = 'Продюсер',
      'read', false, 'create', false, 'update', false, 'delete', false,
      'financeRead', false, 'financeWrite', false, 'financeUnlock', false
    ),
    'smeta_settings',
    jsonb_build_object(
      'access',
        (r."isSystem" AND r."name" = 'Продюсер')
        OR (
          COALESCE(r."permissions"->'finance'->>'access' = 'true', false)
          AND (
            COALESCE(r."permissions"->'finance'->>'create' = 'true', false)
            OR COALESCE(r."permissions"->'finance'->>'update' = 'true', false)
            OR COALESCE(r."permissions"->'finance'->>'delete' = 'true', false)
          )
        ),
      'read', false, 'create', false, 'update', false, 'delete', false,
      'financeRead', false, 'financeWrite', false, 'financeUnlock', false
    )
  )
WHERE jsonb_typeof(r."permissions") = 'object'
  AND r."permissions"->'smeta_return' IS NULL
  AND r."permissions"->'smeta_settings' IS NULL;
