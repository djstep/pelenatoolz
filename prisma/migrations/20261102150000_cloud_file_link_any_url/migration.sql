-- Волна 3, диски, хвосты шагов 1–2: «Вставить ссылку» принимает любой https-адрес.
-- Источник (Google / Яндекс) у ссылки на другой сайт пустой. Данные не меняются.
ALTER TABLE "CloudFileLink" ALTER COLUMN "provider" DROP NOT NULL;
