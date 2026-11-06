#!/bin/bash
# Разовый переход работающего сервера на отдельные роли базы. Создаёт пароли для pelena_owner
# и pelena_app и разделяет настройки:
#   .env.prod   только сайт: DATABASE_URL от pelena_app, секреты входа, почты
#   .env.admin  администрирование: POSTGRES_PASSWORD, MIGRATE_DATABASE_URL, COMPOSE_FILE
# Значения на экран не выводятся. При сбое файлы настроек возвращаются как были.
#   REGISTRATION_ALLOWLIST=<адреса> bash ops/db/setup-roles.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077

[ -f .env.prod ] || { echo "Нет .env.prod"; exit 1; }
[ ! -e .env.admin ] || { echo ".env.admin уже есть, роли настроены"; exit 1; }
[ -n "${REGISTRATION_ALLOWLIST:-}" ] || { echo "Задайте REGISTRATION_ALLOWLIST"; exit 1; }

value() { grep "^$1=" .env.prod | head -1 | cut -d= -f2-; }
POSTGRES_PASSWORD=$(value POSTGRES_PASSWORD)
[ -n "$POSTGRES_PASSWORD" ] || { echo "В .env.prod нет POSTGRES_PASSWORD"; exit 1; }
OWNER_PASSWORD=$(openssl rand -hex 32)
APP_PASSWORD=$(openssl rand -hex 32)

rollback() {
  ln -sfn .env.prod .env
  rm -f .env.admin .env.prod.new
  echo "Сбой, файлы настроек возвращены."
}
trap rollback ERR

# Compose разбирает файл целиком и без этих значений не запускается.
{
  echo "COMPOSE_FILE=docker-compose.prod.yml"
  echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  echo "MIGRATE_DATABASE_URL=postgresql://pelena_owner:$OWNER_PASSWORD@db:5432/pelena"
} > .env.admin
chmod 600 .env.admin
ln -sfn .env.admin .env

docker compose exec -T db psql -U pelena -d pelena -X -q -v ON_ERROR_STOP=1 -f - < ops/db/roles.sql
# Через stdin: в аргументах процесса паролей нет.
printf "ALTER ROLE pelena_owner PASSWORD '%s';\nALTER ROLE pelena_app PASSWORD '%s';\nREVOKE CONNECT ON DATABASE postgres FROM PUBLIC;\n" \
  "$OWNER_PASSWORD" "$APP_PASSWORD" \
  | docker compose exec -T db psql -U pelena -d postgres -X -q -v ON_ERROR_STOP=1

{
  grep -vE '^(COMPOSE_FILE|POSTGRES_PASSWORD|DATABASE_URL|DIRECT_URL|REGISTRATION_ALLOWLIST)=' .env.prod
  echo "DATABASE_URL=postgresql://pelena_app:$APP_PASSWORD@db:5432/pelena"
  echo "REGISTRATION_ALLOWLIST=$REGISTRATION_ALLOWLIST"
} > .env.prod.new
chmod 600 .env.prod.new
mv .env.prod.new .env.prod
trap - ERR
unset POSTGRES_PASSWORD OWNER_PASSWORD APP_PASSWORD
echo "Роли настроены, настройки разделены."
