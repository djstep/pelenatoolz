# Копии базы и файлов

Все команды выполняются на сервере. Значения секретов в репозиторий и в чат не попадают.

| Что | Где | Срок |
|---|---|---|
| Дамп базы, шифрование `age` | `/mnt/data/backups/db` | 7 дней |
| То же в облаке | `pelena-backups/db`, Object Lock | Срок блокировки и правило очистки |
| `storage`, `uploads`, шифрование `rclone crypt` | `pelena-files/data` | Удалённое хранится 30 дней как старые версии |

Хранить у владельца в менеджере паролей: закрытый ключ `age`, пароль и соль файлов, а также весь `.env.prod`
и `.env.admin`. Без `CLOUD_TOKEN_SECRET` из `.env.prod` подключённые диски после восстановления базы придётся
подключать заново.

Закрытого ключа `age` на сервере нет: взлом сервера не открывает старые дампы.
Пароль и соль файлов на сервере есть: `rclone crypt` без них не работает, а `rclone obscure` не шифрует.
Значит, с сервера файлы в облаке читаются, зато сами файлы и так лежат на нём.

## Настройка нового сервера без копий

`rclone` ставится с `rclone.org`, версия из Ubuntu устарела. Сумму пакета сверить с `SHA256SUMS`.
База должна быть уже поднята: роли, пароли и миграции, как в следующем разделе, без шага восстановления.

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
Метку диска ставить только после восстановления файлов: пока её нет, ночная копия отправляет только дамп.

Подготовить сервер: Docker, код проекта, диск на `/mnt/data` с папками `storage`, `uploads`, `backups`,
`.env.prod` и `.env.admin` из менеджера паролей и ссылка `.env` на `.env.admin`,
`docker volume create pelena_pgdata`, `age` и `rclone` как в разделе выше. Затем:

```bash
sudo bash ops/backup/install.sh
sudo pelena-backup-keys
sudo pelena-backup-adopt
```

Файлы, команды выполнять именно так, одной строкой: метка ставится только при полном успехе.

```bash
sudo rclone --config /etc/pelena-backup/rclone.conf copy files:storage /mnt/data/storage && sudo rclone --config /etc/pelena-backup/rclone.conf copy files:uploads /mnt/data/uploads && sudo chown -R 1001:1001 /mnt/data/storage /mnt/data/uploads && sudo touch /mnt/data/.pelena-data-disk
```

База и запуск, из папки проекта:

Пароли ролей новая база получает из `.env.admin` и `.env.prod`: при запросе вставляются те же значения.
Ошибка в пароле `pelena_owner` проявится на `migrate`, в пароле `pelena_app` — при запуске сайта.
`roles.sql` выполняется дважды: первый раз создаёт роли, второй закрепляет права на таблицы после миграции.

```bash
docker compose up -d db
docker compose exec -T db psql -U pelena -d pelena -X -q -v ON_ERROR_STOP=1 -f - < ops/db/roles.sql
docker compose exec db psql -U pelena -d postgres -c '\password pelena_owner'
docker compose exec db psql -U pelena -d postgres -c '\password pelena_app'
docker compose run --rm migrate
docker compose exec -T db psql -U pelena -d pelena -X -q -v ON_ERROR_STOP=1 -f - < ops/db/roles.sql
docker compose up -d app
sudo pelena-backup-restore
sudo systemctl enable --now pelena-backup.timer pelena-backup-check.timer pelena-backup-weekly.timer
sudo pelena-backup-mail
```

Если умер только HDD, сервер и ключи на месте: нужен только шаг с файлами.

## Список адресов регистрации

`REGISTRATION_ALLOWLIST` в `.env.prod`: адреса через запятую, точку с запятой или пробел, регистр не важен.
После правки: `docker compose up -d app`.

Письма-подтверждения нет: кто первым зарегистрирует адрес из списка, тот и получит право создавать проекты.
Поэтому владелец адреса регистрируется сразу, а новый адрес добавляется в список только перед его регистрацией.

## Защита от пустого диска

Копия файлов не запускается, если на диске нет метки `.pelena-data-disk`, папка пуста при непустой копии
или файлов стало меньше больше чем на 10% и ещё 5. Дамп базы при этом всё равно уходит в облако.

Если большое удаление верное, например удалён проект, разрешите его на один запуск:

```bash
sudo touch /etc/pelena-backup/allow-mass-delete
sudo systemctl start pelena-backup.service
```

После успешной копии разрешение снимается само, неиспользованное устаревает через два часа.
Защита не ловит мелкую потерю: до 10% и ещё 5 файлов за ночь проходят без письма.

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

Копия разворачивается в отдельную базу при работающем сайте. Затем команда показывает код на сервере и миграции,
которые применятся, и просит ввести `ВОССТАНОВИТЬ`. Только после этого сайт останавливается, а базы меняются
именами одной транзакцией. Старая остаётся как `pelena_before_restore`. Новые образы команда не собирает.

**Если причина восстановления — плохая миграция**, сначала верните код: иначе она применится к копии снова.
На вопросе команды откажитесь, затем:

```bash
git checkout <коммит до миграции>
docker compose build app migrate
sudo pelena-backup-restore
```

Все команды ниже — из папки проекта.

Откат на старую базу. После него запускается тот код, образы которого сейчас собраны:

```bash
docker compose stop app
docker compose exec -T db psql -U pelena -d postgres -c 'ALTER DATABASE pelena RENAME TO pelena_failed; ALTER DATABASE pelena_before_restore RENAME TO pelena'
docker compose up -d app
```

Если откат был, неудачная база остаётся как `pelena_failed`. Когда восстановленная база проверена и старая не нужна:

```bash
docker compose exec -T db dropdb -U pelena pelena_before_restore
```

Если команда сообщила, что осталась база `pelena_restore`:

```bash
docker compose exec -T db dropdb -U pelena pelena_restore
```

Проверка без изменения рабочей базы: `sudo pelena-backup-restore-test`.

## Правила очистки

Настраиваются только через S3 API отдельным временным ключом с ролями `s3e.editor-acl` и `s3e.viewer-acl`
на эти два бакета. Запись заменяет конфигурацию целиком. `ExpiredObjectDeleteMarker` cloud.ru не принимает,
пустые пометки удаления остаются. Основному ключу `pelena-backup` эти права не выдаются.

Переход на хранение 30 дней: поднять блокировку по умолчанию в панели, затем `sudo pelena-lifecycle-30d`.
Старые дампы удаляются примерно через 32 дня: `Expiration` 31 день и ещё день на неактуальную версию.
