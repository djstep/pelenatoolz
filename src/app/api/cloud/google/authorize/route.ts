import { startCloudConnect } from "@/features/cloud/lib/oauth-flow";

// Vercel (Fluid compute, потолок 300 с): выгрузка на диск (до 50 с) и пересчёт доступов к папкам после ответа
// (`after()`, до 40 с) идут в одной функции — до 120 с. OAuth дисков — здесь же.
export const maxDuration = 120;

/** Начало подключения — POST из формы «Подключить» (см. startCloudConnect). */
export async function POST(request: Request) {
  return startCloudConnect(request, "GOOGLE_DRIVE");
}
