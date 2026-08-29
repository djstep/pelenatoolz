import { NextResponse } from "next/server";
import { requireUser } from "@/features/auth/session";
import { appOrigin, signOAuthState } from "@/features/cloud/lib/token-crypto";

export async function GET(request: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const returnTo = searchParams.get("returnTo");

  if (!projectId || !returnTo) {
    return NextResponse.json({ error: "projectId и returnTo обязательны" }, { status: 400 });
  }

  const clientId = process.env.YANDEX_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "YANDEX_CLIENT_ID не настроен" },
      { status: 500 },
    );
  }

  const state = signOAuthState({
    userId: user.id!,
    projectId,
    provider: "YANDEX_DISK",
    returnTo,
  });

  const redirectUri = `${appOrigin()}/api/cloud/yandex/callback`;
  const url =
    `https://oauth.yandex.ru/authorize?` +
    `response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent("cloud_api:disk.read")}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(url);
}
