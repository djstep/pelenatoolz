# PELENA [ПЕЛЕНА]

Веб-платформа управления кинопроизводством (MVP). Модуль 1: авторизация, проекты, роли и приглашения.

## Стек

- Next.js 16 (App Router, `output: "standalone"`) + TypeScript + Tailwind
- Auth.js (email/password, JWT)
- PostgreSQL + Prisma
- next-intl (UI: ru по умолчанию, en готов)
- Хостинг: свой сервер в РФ (cloud.ru), сайт и PostgreSQL в Docker, файлы на диске сервера — см. `ops/README.md`

## Быстрый старт

1. Скопируйте `.env.example` → `.env` и задайте `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `REGISTRATION_ALLOWLIST`. Без последнего регистрация открыта только по приглашению, а проект не создать никому. На сервере переменные лежат в `.env.prod` (см. шапку `docker-compose.prod.yml`).
2. Поднимите Postgres (Docker Desktop):

```bash
docker compose up -d
```

Либо укажите адрес любого другого PostgreSQL.

3. Примените миграции и запустите:

```bash
npm install
npm run db:migrate
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) → редирект на `/ru/login`.

`npm run dev`, `npm start`, `npm test` и e2e считают время в UTC, как сервер (`scripts/tz-utc.mjs`, `TZ` в `docker-compose.prod.yml`). Запускать сайт напрямую через `next dev` не стоит: на компьютере в Москве даты без времени запишутся на день раньше.

## Что умеет модуль 1

- Регистрация / вход (email + пароль)
- Создание проекта (создатель = продюсер)
- Список проектов пользователя
- Участники: роли, смена роли, удаление
- Invite-ссылки с ролью и сроком действия
- Матрица прав по ролям в коде (`src/features/memberships/permissions.ts`)

## Структура

```
src/features/auth|projects|memberships  — доменные фичи
src/shared/{db,i18n,ui,lib}             — общая инфраструктура
prisma/migrations                       — инкрементальные миграции
messages/{ru,en}.json                   — UI-строки
```

## Docker-сборка приложения

```bash
docker build -t film-prod .
```

Образ использует Next.js standalone. На сервере (cloud.ru) он собирается и запускается через `sudo pelena-deploy`, см. `ops/README.md`.
