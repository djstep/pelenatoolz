# PELENA [ПЕЛЕНА]

Веб-платформа управления кинопроизводством (MVP). Модуль 1: авторизация, проекты, роли и приглашения.

## Стек

- Next.js 16 (App Router, `output: "standalone"`) + TypeScript + Tailwind
- Auth.js (email/password, JWT)
- PostgreSQL + Prisma
- next-intl (UI: ru по умолчанию, en готов)
- Хостинг-ориентир: Vercel + Neon + Cloudflare R2 (без vendor-lock в коде)

## Быстрый старт

1. Скопируйте `.env.example` → `.env` и задайте `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`.
2. Поднимите Postgres (Docker Desktop):

```bash
docker compose up -d
```

Либо укажите connection string Neon / другого Postgres.

3. Примените миграции и запустите:

```bash
npm install
npm run db:migrate
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) → редирект на `/ru/login`.

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

Образ использует Next.js standalone — тот же билд подойдёт для Selectel/Yandex Cloud позже.
