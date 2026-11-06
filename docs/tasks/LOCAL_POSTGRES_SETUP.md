# Локальный Postgres для dev и e2e

Зачем: один запрос к базе в Neon идёт около 160 мс, поэтому e2e медленный. На этом компьютере запрос пойдёт за доли миллисекунды.

Neon и сайт на Vercel это не затрагивает: меняются только файлы `.env` и `.env.e2e` на этом компьютере.

**Пароли в чат не присылайте.** Команды этой инструкции в репозитории ничего не меняют.

## Что ставить

**PostgreSQL 18, Windows x86-64, обычный установщик EDB:** <https://www.postgresql.org/download/windows/>

В Neon стоит 18.6, на этом компьютере тоже 18.6. Подойдёт любая версия 18.x, главное, чтобы первая цифра была 18.

| Настройка базы | В Neon | Локально |
|---|---|---|
| Версия | 18.6 | 18.6 |
| Кодировка | UTF8 | UTF8 |
| `LOCALE_PROVIDER` | `builtin` | `builtin` |
| `BUILTIN_LOCALE` | `C.UTF-8` | `C.UTF-8` |
| `LC_COLLATE`, `LC_CTYPE` | `C.UTF-8` | `C` |
| Часовой пояс | GMT | GMT |
| Расширения | только `plpgsql` | ничего ставить не надо |

Единственное отличие от Neon — `LC_COLLATE` и `LC_CTYPE`. Сортировку и смену регистра при `LOCALE_PROVIDER 'builtin'` задаёт `BUILTIN_LOCALE`, а он совпадает. Полнотекстового поиска в проекте нет. После подключения Claude проверит это запросом на русском тексте.

## Шаг 1. Установка

1. Запустите установщик. Папка на этом компьютере: `H:\Apps\PostgreSQL`.
2. Компоненты: нужны **PostgreSQL Server** и **Command Line Tools**. pgAdmin по желанию. Stack Builder не нужен.
3. Придумайте пароль суперпользователя `postgres` и сохраните его.
4. Порт оставьте **5432**. Если он занят и установщик предложил другой, запомните номер: он понадобится в шаге 3.
5. Locale оставьте `Default locale`: настройки баз заданы ниже в командах.
6. В конце снимите галочку запуска Stack Builder.

Проверка в PowerShell, служба должна быть `Running`:

```powershell
Get-Service postgresql*
```

## Шаг 2. Пользователь и две базы

Откройте консоль Postgres, она попросит пароль `postgres`:

```powershell
& "H:\Apps\PostgreSQL\bin\psql.exe" -U postgres -h localhost
```

Придумайте второй пароль, для пользователя `pelena`. Только латинские буквы и цифры: другие символы ломают адрес базы.

Вставьте команды по одной, заменив `ПАРОЛЬ` на него:

```sql
CREATE ROLE pelena LOGIN CREATEDB PASSWORD 'ПАРОЛЬ';
CREATE DATABASE pelena_dev OWNER pelena ENCODING 'UTF8' TEMPLATE template0 LOCALE_PROVIDER 'builtin' BUILTIN_LOCALE 'C.UTF-8' LC_COLLATE 'C' LC_CTYPE 'C';
CREATE DATABASE pelena_e2e OWNER pelena ENCODING 'UTF8' TEMPLATE template0 LOCALE_PROVIDER 'builtin' BUILTIN_LOCALE 'C.UTF-8' LC_COLLATE 'C' LC_CTYPE 'C';
ALTER DATABASE pelena_dev SET timezone TO 'GMT';
ALTER DATABASE pelena_e2e SET timezone TO 'GMT';
```

На каждую команду должен прийти ответ `CREATE ROLE`, `CREATE DATABASE` или `ALTER DATABASE`. Выйти: `\q`.

`CREATEDB` нужен пользователю для `prisma migrate dev`: эта команда создаёт временную базу для проверки миграций.

На этом компьютере базы созданы с этими настройками. Если какая-то команда вернёт ошибку, пришлите её текст, но не строку с паролем.

Имена `pelena_dev` и `pelena_e2e` менять нельзя: с другими проверки базы дадут отказ.

## Шаг 3. Адреса баз

Откройте файлы сами, Claude их не читает и не меняет. Старые строки не удаляйте, а поставьте перед ними `#`: так легко вернуться на Neon. Остальные строки не трогайте, в `.env.e2e` там пароли тестовых пользователей.

`.env`:

```
DATABASE_URL="postgresql://pelena:ПАРОЛЬ@localhost:5432/pelena_dev"
DIRECT_URL="postgresql://pelena:ПАРОЛЬ@localhost:5432/pelena_dev"
```

`.env.e2e`:

```
E2E_DATABASE_URL="postgresql://pelena:ПАРОЛЬ@localhost:5432/pelena_e2e"
E2E_DIRECT_URL="postgresql://pelena:ПАРОЛЬ@localhost:5432/pelena_e2e"
```

Обе строки в каждом файле одинаковые: пула здесь нет. `sslmode` не нужен. Если порт другой, замените `5432`.

Напишите мне «готово». Дальше работает Claude.

## Шаг 4. Что сделает Claude

1. `npm run db:whoami` — покажет только сервер и имя базы. Ожидается `localhost / pelena_dev` и `localhost / pelena_e2e`.
2. Покажет `npm run db:status:e2e` и `npx prisma migrate status`: на пустой базе все 72 миграции будут не применены.
3. `npm run db:migrate:e2e` и `npm run db:migrate`.
4. `npm run e2e`, затем `npm run e2e:drive`, с замером времени.

### Как схема появляется с нуля

- `migrate deploy` применяет файлы из `prisma/migrations/` по порядку, от первого до последнего, и записывает их в служебную таблицу `_prisma_migrations`. `prisma db push` не используется.
- Сид запускается сам в начале `npm run e2e` и `npm run e2e:drive`. На пустой базе он создаёт четырёх тестовых пользователей, проект «E2E приёмка», съёмочные дни, смету, карточки, команду и утверждённую версию вызывного. Пароли он берёт из `.env.e2e`.
- База `pelena_dev` останется пустой, сида для неё нет: на локальном сайте нужно будет зарегистрироваться заново. Данные из Neon не переносятся, там только временные тестовые данные.

### Что проверено на пустой базе

- `e2e:drive` без предыдущего `npm run e2e` прошёл, 54 из 54.
- Сид с нуля прошёл, повторный запуск ничего не добавил.
- `a2`: чужой проект создаёт сид, все проверки доступа выполняются.

Итоговое время — в `docs/tasks/PERF_E2E_SPEED_REPORT.md`.

## Как вернуться на Neon

Уберите `#` со старых строк и поставьте перед локальными. Больше ничего менять не нужно: Neon остаётся в списке разрешённых баз.
