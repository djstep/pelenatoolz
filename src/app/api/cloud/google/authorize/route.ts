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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID не настроен" },
      { status: 500 },
    );
  }

  const state = signOAuthState({
    userId: user.id!,
    projectId,
    provider: "GOOGLE_DRIVE",
    returnTo,
  });

  const redirectUri = `${appOrigin()}/api/cloud/google/callback`;
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/drive.readonly email profile",
  );
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(url);
}
