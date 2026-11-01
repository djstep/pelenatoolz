import { startCloudConnect } from "@/features/cloud/lib/oauth-flow";

/** Начало подключения — POST из формы «Подключить» (см. startCloudConnect). */
export async function POST(request: Request) {
  return startCloudConnect(request, "GOOGLE_DRIVE");
}
