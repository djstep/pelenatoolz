-- Волна 3, диски, шаг 1: права и аккаунт подключения, пометка «нужно переподключить». Только добавление.
ALTER TABLE "CloudConnection" ADD COLUMN "scopes" TEXT;
ALTER TABLE "CloudConnection" ADD COLUMN "accountSubject" TEXT;
ALTER TABLE "CloudConnection" ADD COLUMN "needsReconnectAt" TIMESTAMP(3);
