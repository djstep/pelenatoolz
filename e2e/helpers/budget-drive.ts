import "./use-e2e-database";
import { config } from "dotenv";

/**
 * Для e2e папок смет (`c9-budget-drive-access.spec.ts`): настоящие серверные функции против
 * заглушки дисков, без страниц. Запуск из теста:
 *   node --conditions=react-server --import tsx e2e/helpers/budget-drive.ts <команда> <projectId> …
 * Команды:
 *   connect <projectId> <keeperMembershipId>   — диск проекта на заглушке (вход в «Google» заглушки, токены в базу);
 *   ensure <projectId> <actorUserId> summary|<departmentId> — папка смет (`ensureProjectDriveFolder`);
 *   sync <projectId> <actorUserId>              — пересчёт доступов, как кнопка «Синхронизировать»;
 *   rename <projectId> <departmentId> <actorUserId> — переименование папок цеха (`renameDepartmentFolders`);
 *   overview <projectId>                        — раздел «Диск проекта» (`getDriveAccessOverview`).
 * Нужны `CLOUD_STUB_GOOGLE_URL` (адрес заглушки) и база из `.env.e2e`. Печатает итог одной строкой JSON.
 */

config({ quiet: true });

const STUB_GOOGLE = process.env.CLOUD_STUB_GOOGLE_URL;
if (!STUB_GOOGLE || process.env.NODE_ENV === "production") {
  console.error("Нужен CLOUD_STUB_GOOGLE_URL (заглушка) и не production");
  process.exit(2);
}

const [command, projectId, ...args] = process.argv.slice(2);

/** Вход в «Google» заглушки: токены и аккаунт (почта и `sub` — из `id_token`). */
async function stubLogin() {
  const redirectUri = "http://localhost/api/cloud/google/callback";
  const q = new URLSearchParams({ client_id: "cid", redirect_uri: redirectUri, response_type: "code", state: "s" });
  const res = await fetch(`${STUB_GOOGLE}/o/oauth2/v2/auth?${q}`, { redirect: "manual" });
  const code = new URL(res.headers.get("location") ?? "").searchParams.get("code");
  if (!code) throw new Error("заглушка не выдала code");
  const tokenRes = await fetch(`${STUB_GOOGLE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: "cid",
      client_secret: "secret",
    }),
  });
  const json = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  const payload = JSON.parse(Buffer.from((json.id_token ?? "..").split(".")[1] ?? "", "base64url").toString() || "{}") as {
    email?: string;
    sub?: string;
  };
  return { ...json, email: payload.email ?? null, sub: payload.sub ?? null };
}

async function main() {
  // После `config()`: модули приложения читают переменные окружения при загрузке.
  const { prisma } = await import("@/shared/db/prisma");
  try {
    if (!projectId) throw new Error("нет projectId");
    if (command === "connect") {
      const [keeperMembershipId] = args;
      const { encryptSecret } = await import("@/features/cloud/lib/token-crypto");
      const t = await stubLogin();
      const data = {
        provider: "GOOGLE_DRIVE" as const,
        keeperMembershipId,
        accountEmail: t.email,
        accountSubject: t.sub,
        accessToken: encryptSecret(t.access_token),
        refreshToken: t.refresh_token ? encryptSecret(t.refresh_token) : null,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
        scopes: t.scope ?? "https://www.googleapis.com/auth/drive.file openid email",
        needsReconnectAt: null,
        status: "ACTIVE" as const,
        detachedAt: null,
        detachReason: null,
        connectedAt: new Date(),
      };
      // Прежний диск проекта (от других e2e) — с чистого листа: папки уходят каскадом.
      await prisma.projectDrive.deleteMany({ where: { projectId } });
      const drive = await prisma.projectDrive.create({ data: { projectId, ...data } });
      console.log(JSON.stringify({ driveId: drive.id, accountEmail: t.email }));
    } else if (command === "ensure") {
      const [actorUserId, target] = args;
      const { ensureProjectDriveFolder } = await import("@/features/cloud/lib/project-drive-folders");
      const result = await ensureProjectDriveFolder(
        projectId,
        target === "summary" ? { kind: "budget-summary" } : { kind: "budget-department", departmentId: target! },
        actorUserId!,
      );
      console.log(JSON.stringify(result));
    } else if (command === "sync") {
      const [actorUserId] = args;
      const { syncProjectDriveAccess } = await import("@/features/cloud/lib/drive-access-sync");
      console.log(JSON.stringify(await syncProjectDriveAccess(projectId, { actorUserId: actorUserId!, trigger: "manual" })));
    } else if (command === "rename") {
      const [departmentId, actorUserId] = args;
      const { renameDepartmentFolders } = await import("@/features/cloud/lib/project-drive-folders");
      console.log(JSON.stringify({ renamed: await renameDepartmentFolders(projectId, departmentId!, actorUserId!) }));
    } else if (command === "overview") {
      const { getDriveAccessOverview } = await import("@/features/cloud/lib/drive-access-sync");
      console.log(JSON.stringify(await getDriveAccessOverview(projectId)));
    } else {
      throw new Error(`неизвестная команда ${command}`);
    }
  } catch (e) {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
