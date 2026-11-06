#!/bin/bash
# Ставит команды копирования и расписание. Таймеры включаются отдельно, после создания ключей.
#   sudo bash ops/backup/install.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
DIR=$(cd "$(dirname "$0")" && pwd)

install -d -m 755 -o root -g root /usr/local/lib/pelena-backup
install -m 644 -o root -g root "$DIR/secret-input.sh" /usr/local/lib/pelena-backup/secret-input.sh
install -m 644 -o root -g root "$DIR/../db/roles.sql" /usr/local/lib/pelena-backup/db-roles.sql

for F in pelena-backup pelena-backup-adopt pelena-backup-check pelena-backup-init pelena-backup-keys \
  pelena-backup-mail pelena-backup-restore pelena-backup-restore-test pelena-lifecycle-30d pelena-notify; do
  install -m 700 -o root -g root "$DIR/$F" "/usr/local/sbin/$F"
done
for F in pelena-backup.service pelena-backup.timer pelena-backup-failed.service \
  pelena-backup-check.service pelena-backup-check.timer \
  pelena-backup-weekly.service pelena-backup-weekly.timer; do
  install -m 644 -o root -g root "$DIR/$F" "/etc/systemd/system/$F"
done
install -m 700 -o root -g root "$DIR/../deploy/pelena-deploy" /usr/local/sbin/pelena-deploy
install -m 700 -o root -g root "$DIR/../deploy/pelena-oauth" /usr/local/sbin/pelena-oauth
systemctl daemon-reload
echo "Установлено. Включить: sudo systemctl enable --now pelena-backup.timer pelena-backup-check.timer pelena-backup-weekly.timer"
