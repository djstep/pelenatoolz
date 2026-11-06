# Копии базы и файлов

Все команды выполняются на сервере. Значения секретов в репозиторий и в чат не попадают.

| Что | Где | Срок |
|---|---|---|
| Дамп базы, шифрование `age` | `/mnt/data/backups/db` | 7 дней |
| То же в облаке | `pelena-backups/db`, Object Lock | Срок блокировки и правило очистки |
| `storage`, `uploads`, шифрование `rclone crypt` | `pelena-files/data` | Удалённое хранится 30 дней как старые версии |

Хранить у владельца в менеджере паролей: закрытый ключ `age`, пароль и соль файлов, а также весь `.env.prod`.
Без `CLOUD_TOKEN_SECRET` из него подключённые диски после восстановления базы придётся подключать заново.

Закрытого ключа `age` на сервере нет: взлом сервера не открывает старые дампы.
Пароль и соль файлов на сервере есть: `rclone crypt` без них не работает, а `rclone obscure` не шифрует.
Значит, с сервера файлы в облаке читаются, зато сами файлы и так лежат на нём.

## Настройка нового сервера без копий

`rclone` ставится с `rclone.org`, версия из Ubuntu устарела. Сумму пакета сверить с `SHA256SUMS`.

```bash
sudo apt-get install -y age
sudo dpkg -i rclone-*-linux-amd64.deb
sudo bash ops/backup/install.sh
sudo pelena-backup-keys
sudo pelena-backup-init
sudo touch /mnt/data/.pelena-data-disk
sudo systemctl start pelena-backup.service
sudo pelena-backup-restore-test
sudo systemctl enable --now pelena-backup.timer pelena-backup-check.timer pelena-backup-weekly.timer
sudo pelena-backup-mail
```

## Перенос на новый сервер или новый диск

`pelena-backup-init` здесь не запускать: новые ключи не прочитают старые копии. Команда сама откажет.
Метку диска ставить только после восстановления файлов, иначе ночная копия не остановится.

```bash
sudo bash ops/backup/install.sh
sudo pelena-backup-keys
sudo pelena-backup-adopt
sudo rclone --config /etc/pelena-backup/rclone.conf copy files:storage /mnt/data/storage
sudo rclone --config /etc/pelena-backup/rclone.conf copy files:uploads /mnt/data/uploads
sudo chown -R 1001:1001 /mnt/data/storage /mnt/data/uploads
sudo touch /mnt/data/.pelena-data-disk
```

Если умер только HDD, сервер и ключи на месте: шаги с `keys` и `adopt` не нужны.

## Защита от пустого диска

Копия файлов не запускается, если на диске нет метки `.pelena-data-disk`, папка пуста при непустой копии
или файлов стало меньше больше чем на 10% и ещё 5. Дамп базы при этом всё равно уходит в облако.

Если большое удаление верное, например удалён проект, разрешите его на один запуск:

```bash
sudo touch /etc/pelena-backup/allow-mass-delete
sudo systemctl start pelena-backup.service
```

После успешной копии разрешение снимается само.

Удалённое из `pelena-files` остаётся старыми версиями 30 дней, но обычная команда `rclone copy` их не видит.

## Проверка

```bash
systemctl list-timers 'pelena-backup*'
sudo journalctl -u pelena-backup.service -n 30
sudo cat /mnt/data/backups/last-success
```

## Уведомления

Письмо через Яндекс: при сбое копии сразу, при проверке в 09:00, если успешной копии не было дольше 26 часов,
и сводка по понедельникам. **Если сводка не пришла, сломаны сами уведомления.**
Пока `pelena-backup-mail` не выполнена, письма не отправляются совсем.

`api.telegram.org` и `hc-ping.com` с сервера недоступны. Если сервер выключен целиком, письмо отправить некому.
Настройки в `/etc/pelena-backup/mail.conf`. Новые команды со скрытым вводом используют `secret-input.sh`.

## Восстановление базы

Только по решению владельца.

```bash
sudo pelena-backup-restore
```

Команда разворачивает копию в новую базу и только после успеха меняет базы именами. Старая остаётся как
`pelena_before_restore`. Если копия не развернулась, рабочая база и сайт не затронуты.

Откат и удаление старой базы, из папки проекта:

```bash
docker compose stop app
docker compose exec -T db psql -U pelena -d postgres -c 'ALTER DATABASE pelena RENAME TO pelena_failed'
docker compose exec -T db psql -U pelena -d postgres -c 'ALTER DATABASE pelena_before_restore RENAME TO pelena'
docker compose up -d app
```

Когда восстановленная база проверена и старая не нужна:

```bash
docker compose exec -T db dropdb -U pelena pelena_before_restore
```

Проверка без изменения рабочей базы: `sudo pelena-backup-restore-test`.

## Правила очистки

Настраиваются только через S3 API отдельным временным ключом с ролями `s3e.editor-acl` и `s3e.viewer-acl`
на эти два бакета. Запись заменяет конфигурацию целиком. `ExpiredObjectDeleteMarker` cloud.ru не принимает,
пустые пометки удаления остаются. Основному ключу `pelena-backup` эти права не выдаются.

Переход на хранение 30 дней: поднять блокировку по умолчанию в панели, затем `sudo pelena-lifecycle-30d`.
Старые дампы удаляются примерно через 32 дня: `Expiration` 31 день и ещё день на неактуальную версию.
