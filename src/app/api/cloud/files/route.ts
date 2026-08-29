import { NextResponse } from "next/server";
import { CloudProvider } from "@prisma/client";
import { requireUser } from "@/features/auth/session";
import { browseCloudFolder } from "@/features/cloud/lib/cloud-service";

export async function GET(request: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") as CloudProvider | null;
  const folder = searchParams.get("folder") ?? "";

  if (provider !== "GOOGLE_DRIVE" && provider !== "YANDEX_DISK") {
    return NextResponse.json({ error: "Неверный провайдер" }, { status: 400 });
  }

  try {
    const items = await browseCloudFolder(user.id!, provider, folder);
    return NextResponse.json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка чтения облака";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
