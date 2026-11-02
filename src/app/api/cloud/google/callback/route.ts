import { finishCloudConnect } from "@/features/cloud/lib/oauth-flow";

// Vercel: выгрузка на диск (предел 50 с), OAuth дисков и пересчёт доступов к папкам после ответа (`after()`) — до 60 с.
export const maxDuration = 60;

export async function GET(request: Request) {
  return finishCloudConnect(request, "GOOGLE_DRIVE");
}
