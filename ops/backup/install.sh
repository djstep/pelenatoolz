#!/bin/bash
# Ставит команды копирования и расписание. Таймер включается отдельно, после создания ключей.
#   sudo bash ops/backup/install.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
DIR=$(cd "$(dirname "$0")" && pwd)

for F in pelena-backup pelena-backup-init pelena-backup-keys pelena-backup-restore-test; do
  install -m 700 -o root -g root "$DIR/$F" "/usr/local/sbin/$F"
done
install -m 644 -o root -g root "$DIR/pelena-backup.service" /etc/systemd/system/pelena-backup.service
install -m 644 -o root -g root "$DIR/pelena-backup.timer" /etc/systemd/system/pelena-backup.timer
systemctl daemon-reload
echo "Установлено. Включить расписание: sudo systemctl enable --now pelena-backup.timer"
