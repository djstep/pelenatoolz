import { finishCloudConnect } from "@/features/cloud/lib/oauth-flow";

export async function GET(request: Request) {
  return finishCloudConnect(request, "GOOGLE_DRIVE");
}
