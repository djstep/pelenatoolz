import { NextResponse } from "next/server";
import {
  fetchGoogleUserEmail,
} from "@/features/cloud/lib/google-drive";
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
    return NextResponse.redirect(`${fallback}?cloud_error=google`);
  }

  const state = verifyOAuthState(stateRaw);
  if (!state || state.provider !== "GOOGLE_DRIVE") {
    return NextResponse.redirect(`${fallback}?cloud_error=state`);
  }

  const redirectUri = `${appOrigin()}/api/cloud/google/callback`;
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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

  const email = await fetchGoogleUserEmail(tokens.access_token);
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await prisma.cloudConnection.upsert({
    where: {
      userId_provider: {
        userId: state.userId,
        provider: "GOOGLE_DRIVE",
      },
    },
    create: {
      userId: state.userId,
      provider: "GOOGLE_DRIVE",
      accountEmail: email,
      accountLabel: email ?? "Google Диск",
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null,
      expiresAt,
    },
    update: {
      accountEmail: email,
      accountLabel: email ?? "Google Диск",
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : undefined,
      expiresAt,
    },
  });

  return NextResponse.redirect(`${state.returnTo}?cloud_connected=google`);
}
