import { NextResponse } from "next/server";
import { CloudProvider } from "@prisma/client";
import { requireUser } from "@/features/auth/session";
import { browseCloudFolder } from "@/features/cloud/lib/cloud-service";
import { isCloudApiError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import { hasPermission } from "@/features/memberships/permissions";
import { getProjectForUser } from "@/features/projects/queries";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";

/**
 * Просмотр своего диска в контексте проекта. Со страницы «Файлы» убран (решение по вопросу 4 —
 * «Вставить ссылку»), маршрут оставлен с проверками: участник проекта и право «Файлы», как страница.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const provider = searchParams.get("provider") as CloudProvider | null;
  const folder = searchParams.get("folder") ?? "";

  if (!projectId) {
    return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
  }
  const project = await getProjectForUser(projectId, user.id!);
  const role = project?.memberships[0]?.role;
  if (!role) {
    return NextResponse.json({ error: "Нет доступа к проекту" }, { status: 403 });
  }
  const matrix = parsePermissionMatrix(role.permissions);
  if (!hasPermission(matrix, "script:read") && !hasPermission(matrix, "project:read")) {
    return NextResponse.json({ error: "Нет доступа к файлам" }, { status: 403 });
  }

  if (provider !== "GOOGLE_DRIVE" && provider !== "YANDEX_DISK") {
    return NextResponse.json({ error: "Неверный провайдер" }, { status: 400 });
  }

  try {
    const items = await browseCloudFolder(user.id!, provider, folder);
    return NextResponse.json({ items });
  } catch (e) {
    if (isCloudReconnectRequiredError(e) || isCloudApiError(e)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[cloud files]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Ошибка чтения облака" }, { status: 400 });
  }
}
