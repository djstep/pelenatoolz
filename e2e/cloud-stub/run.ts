import { startCloudStub } from "./server";

/**
 * Заглушка дисков отдельно (разработка): `npm run cloud-stub` или `npx tsx e2e/cloud-stub/run.ts`.
 * Порт — `CLOUD_STUB_PORT` (по умолчанию 4510); адрес приложения для проверки redirect_uri —
 * `CLOUD_STUB_APP_ORIGIN` (необязательно). Печатает переменные для `.env.local`.
 */
async function main() {
  const port = Number(process.env.CLOUD_STUB_PORT ?? 4510);
  const appOrigin = process.env.CLOUD_STUB_APP_ORIGIN?.trim() || undefined;
  const stub = await startCloudStub({ port, appOrigin });
  console.log(`Заглушка дисков: ${stub.url}`);
  console.log(`CLOUD_STUB_GOOGLE_URL=${stub.googleUrl}`);
  console.log(`CLOUD_STUB_YANDEX_URL=${stub.yandexUrl}`);
  console.log(`Состояние: ${stub.url}/__stub/state · журнал: ${stub.url}/__stub/requests · Ctrl+C — стоп`);

  const stop = () => {
    void stub.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e: unknown) => {
  console.error("Заглушка не запустилась:", e instanceof Error ? e.message : e);
  process.exit(1);
});
