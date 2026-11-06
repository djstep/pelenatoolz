# Копии базы и файлов

Ключи и команды на сервере. Значения секретов в репозиторий и в чат не попадают.

| Что | Где | Срок |
|---|---|---|
| Дамп базы, шифрование `age` | `/mnt/data/backups/db` | 7 дней |
| То же в облаке | `pelena-backups/db`, Object Lock | Срок блокировки и правило очистки |
| `storage`, `uploads`, шифрование `rclone crypt` | `pelena-files/data` | Старые версии 30 дней |

Закрытый ключ `age`, пароль и соль файлов лежат только в менеджере паролей владельца.
Закрытого ключа `age` на сервере нет. Потеря этих значений означает потерю копий.

## Настройка нового сервера

```bash
sudo apt-get install -y age rclone
sudo bash ops/backup/install.sh
sudo pelena-backup-keys
sudo pelena-backup-init
sudo systemctl start pelena-backup.service
sudo pelena-backup-restore-test
sudo systemctl enable --now pelena-backup.timer
```

На сервере, где копии уже есть, `pelena-backup-init` не запускать: новые ключи не прочитают старые копии.
Для переноса на новый сервер раздел `[files]` и `age.pub` восстанавливаются из сохранённых значений.

## Проверка

```bash
systemctl list-timers pelena-backup.timer
journalctl -u pelena-backup.service -n 30
cat /mnt/data/backups/last-success
```

## Восстановление базы

На рабочей базе только по решению владельца: команда заменяет данные.

```bash
rclone --config /etc/pelena-backup/rclone.conf lsf cloud:pelena-backups/db
rclone --config /etc/pelena-backup/rclone.conf copyto cloud:pelena-backups/db/<файл> /dev/shm/restore.age
age -d -i <файл с закрытым ключом> /dev/shm/restore.age > /dev/shm/restore.dump
docker compose stop app
docker compose exec -T db pg_restore -U pelena -d pelena --clean --if-exists --no-owner < /dev/shm/restore.dump
docker compose up -d app
rm -f /dev/shm/restore.age /dev/shm/restore.dump
```

## Правила очистки

Настраиваются только через S3 API отдельным временным ключом с ролями `s3e.editor-acl` и `s3e.viewer-acl`
на эти два бакета. Запись заменяет конфигурацию целиком. `ExpiredObjectDeleteMarker` cloud.ru не принимает.
Основному ключу `pelena-backup` эти права не выдаются.
