import { startCloudConnect } from "@/features/cloud/lib/oauth-flow";

// Vercel: выгрузка на диск (предел 50 с), OAuth дисков и пересчёт доступов к папкам после ответа (`after()`) — до 60 с.
export const maxDuration = 60;

/** Начало подключения — POST из формы «Подключить» (см. startCloudConnect). */
export async function POST(request: Request) {
  return startCloudConnect(request, "YANDEX_DISK");
}
