-- Роли базы. Выполняется суперпользователем в нужной базе, повторный запуск безопасен.
-- Вызывается при первой настройке и при восстановлении из копии: дамп разворачивается без владельцев.
--
--   pelena        суперпользователь, только копии и восстановление
--   pelena_owner  владелец схемы, от него идут миграции
--   pelena_app    сайт: данные своих таблиц, менять структуру не может
--
-- Пароли здесь не задаются, в файлы и журналы они не попадают. Порядок на новом сервере: ops/backup/README.md.

DO $roles$
DECLARE
  item record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pelena_owner') THEN
    CREATE ROLE pelena_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pelena_app') THEN
    CREATE ROLE pelena_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  EXECUTE format('ALTER DATABASE %I OWNER TO pelena_owner', current_database());
  ALTER SCHEMA public OWNER TO pelena_owner;

  -- REASSIGN OWNED здесь не подходит: суперпользователю принадлежат и системные объекты.
  FOR item IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- Последовательности столбцов переходят к новому владельцу вместе с таблицей.
    LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype IN ('i', 'a') AND c.relkind = 'S'
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S') AND d.objid IS NULL
  LOOP
    EXECUTE format(
      'ALTER %s public.%I OWNER TO pelena_owner',
      CASE item.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE'
        ELSE 'TABLE'
      END,
      item.relname
    );
  END LOOP;

  FOR item IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO pelena_owner', item.typname);
  END LOOP;

  FOR item IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO pelena_owner', item.signature);
  END LOOP;

  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pelena_owner, pelena_app', current_database());
  REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
END
$roles$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pelena_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pelena_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pelena_app;

-- Таблицы и последовательности из будущих миграций получают те же права.
ALTER DEFAULT PRIVILEGES FOR ROLE pelena_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pelena_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pelena_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pelena_app;

-- История миграций сайту не нужна. Журнал только дополняется: взлом сайта не должен стирать следы.
-- На пустой базе этих таблиц ещё нет, поэтому после первой миграции файл выполняется ещё раз.
DO $limits$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM pelena_app;
  END IF;
  IF to_regclass('public."AuditLog"') IS NOT NULL THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public."AuditLog" FROM pelena_app;
  END IF;
END
$limits$;
