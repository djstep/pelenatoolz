import { NextResponse } from "next/server";
import { fetchYandexUserEmail } from "@/features/cloud/lib/yandex-disk";
import {
  appOrigin,
  encryptSecret,
  verifyOAuthState,
} from "@/features/cloud/lib/token-crypto";
import { prisma } from "@/shared/db/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const error = searchParams.get("error");

  const fallback = `${appOrigin()}/ru/projects`;

  if (error || !code || !stateRaw) {
    return NextResponse.redirect(`${fallback}?cloud_error=yandex`);
  }

  const state = verifyOAuthState(stateRaw);
  if (!state || state.provider !== "YANDEX_DISK") {
    return NextResponse.redirect(`${fallback}?cloud_error=state`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.YANDEX_CLIENT_ID ?? "",
    client_secret: process.env.YANDEX_CLIENT_SECRET ?? "",
  });

  const tokenRes = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${state.returnTo}?cloud_error=token`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const email = await fetchYandexUserEmail(tokens.access_token);
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await prisma.cloudConnection.upsert({
    where: {
      userId_provider: {
        userId: state.userId,
        provider: "YANDEX_DISK",
      },
    },
    create: {
      userId: state.userId,
      provider: "YANDEX_DISK",
      accountEmail: email,
      accountLabel: email ?? "Яндекс.Диск",
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null,
      expiresAt,
    },
    update: {
      accountEmail: email,
      accountLabel: email ?? "Яндекс.Диск",
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : undefined,
      expiresAt,
    },
  });

  return NextResponse.redirect(`${state.returnTo}?cloud_connected=yandex`);
}
