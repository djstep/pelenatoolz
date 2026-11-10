-- Раздел «Сцены» в матрице прав ролей разделён (JSON в "ProjectRoleDefinition"."permissions").
-- Схема не меняется, меняются только данные.
--
-- Было: «Сцены» (scenes) открывали сценарий, либретто, объекты, скаут, ресурсы и правку персонажей;
-- «Объекты и места» (locations) и «Ресурсы» (elements) давали только ставки; «Персонажи»
-- (characters) нигде не проверялись, страницу персонажей открывал «Актёры: просмотр».
-- Стало: «Сценарий» (screenplay), «Сцены (либретто)» (scenes), «Объекты и места» (locations),
-- «Ресурсы» (elements), «Персонажи» (characters) — каждый со своими просмотром и правкой.
--
-- Всем ролям значения переносятся так, чтобы каждая роль могла ровно то же, что и раньше:
--   screenplay              = как было у scenes;
--   locations, elements     = просмотр/создание/правка/удаление как было у scenes,
--                             ставки — как было (действовали, только если был включён «Доступ»);
--   characters              = просмотр как у «Актёры: просмотр», создание/правка/удаление как у scenes;
--   «Доступ» нового раздела = включён, если включено хоть что-то из перечисленного.
-- Ставка без «Доступа» раньше не действовала — она и сейчас выключается, а не включается.
-- scenes не меняется. Роли, где «Сценарий» уже есть, не трогаются — повторный запуск без вреда.

WITH src AS (
  SELECT
    r."id",
    r."permissions" AS p,
    COALESCE(r."permissions"->'scenes'->>'access' = 'true', false) AS sa,
    COALESCE(r."permissions"->'scenes'->>'read' = 'true', false) AS s_read,
    COALESCE(r."permissions"->'scenes'->>'create' = 'true', false) AS s_create,
    COALESCE(r."permissions"->'scenes'->>'update' = 'true', false) AS s_update,
    COALESCE(r."permissions"->'scenes'->>'delete' = 'true', false) AS s_delete,
    COALESCE(r."permissions"->'actors'->>'access' = 'true', false)
      AND COALESCE(r."permissions"->'actors'->>'read' = 'true', false) AS cast_read,
    COALESCE(r."permissions"->'locations'->>'access' = 'true', false) AS la,
    COALESCE(r."permissions"->'locations'->>'financeRead' = 'true', false) AS l_fin_read,
    COALESCE(r."permissions"->'locations'->>'financeWrite' = 'true', false) AS l_fin_write,
    COALESCE(r."permissions"->'elements'->>'access' = 'true', false) AS ea,
    COALESCE(r."permissions"->'elements'->>'financeRead' = 'true', false) AS e_fin_read,
    COALESCE(r."permissions"->'elements'->>'financeWrite' = 'true', false) AS e_fin_write
  FROM "ProjectRoleDefinition" AS r
  WHERE jsonb_typeof(r."permissions") = 'object'
    AND r."permissions"->'screenplay' IS NULL
),
flags AS (
  SELECT
    src.*,
    sa AND s_read AS v_read,
    sa AND s_create AS v_create,
    sa AND s_update AS v_update,
    sa AND s_delete AS v_delete,
    la AND l_fin_read AS l_fr,
    la AND l_fin_write AS l_fw,
    ea AND e_fin_read AS e_fr,
    ea AND e_fin_write AS e_fw
  FROM src
)
UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = f.p || jsonb_build_object(
  'screenplay', jsonb_build_object(
    'access', f.sa,
    'read', f.s_read,
    'create', f.s_create,
    'update', f.s_update,
    'delete', f.s_delete,
    'financeRead', false,
    'financeWrite', false,
    'financeUnlock', false
  ),
  'locations', jsonb_build_object(
    'access', f.v_read OR f.v_create OR f.v_update OR f.v_delete OR f.l_fr OR f.l_fw,
    'read', f.v_read,
    'create', f.v_create,
    'update', f.v_update,
    'delete', f.v_delete,
    'financeRead', f.l_fr,
    'financeWrite', f.l_fw,
    'financeUnlock', false
  ),
  'elements', jsonb_build_object(
    'access', f.v_read OR f.v_create OR f.v_update OR f.v_delete OR f.e_fr OR f.e_fw,
    'read', f.v_read,
    'create', f.v_create,
    'update', f.v_update,
    'delete', f.v_delete,
    'financeRead', f.e_fr,
    'financeWrite', f.e_fw,
    'financeUnlock', false
  ),
  'characters', jsonb_build_object(
    'access', f.cast_read OR f.v_create OR f.v_update OR f.v_delete,
    'read', f.cast_read,
    'create', f.v_create,
    'update', f.v_update,
    'delete', f.v_delete,
    'financeRead', false,
    'financeWrite', false,
    'financeUnlock', false
  )
)
FROM flags AS f
WHERE r."id" = f."id";
