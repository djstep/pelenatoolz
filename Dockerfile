# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall запускает prisma generate, а схемы на этом шаге ещё нет. Генерация — в prepared.
RUN npm ci --ignore-scripts

# Код, все пакеты и клиент Prisma. Общая основа для сборки сайта и для migrator.
FROM node:22-alpine AS prepared
# Prisma на Alpine нужен openssl.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate

FROM prepared AS builder
RUN npm run build

# Разовые команды на сервере: миграции и сброс пароля. Prisma CLI есть только здесь,
# поэтому образ не собирает сайт, а рабочий образ не содержит CLI.
FROM prepared AS migrator
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Сюда сайт пишет загрузки, а работает он не от root. На сервере обе папки подключаются
# с диска (docker-compose.prod.yml), иначе файлы пропадут при обновлении сайта.
RUN mkdir -p storage public/uploads && chown -R nextjs:nodejs storage public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
