import "./use-e2e-database";
import { config } from "dotenv";

/**
 * Для e2e шага 5: создать папку на диске проекта настоящей `ensureProjectDriveFolder` (как это
 * сделает выгрузка шага 6) — против заглушки дисков. Запуск из теста:
 *   node --conditions=react-server --import tsx e2e/helpers/ensure-drive-folder.ts <projectId> <actorUserId> common|<departmentId>
 * Нужны `CLOUD_STUB_GOOGLE_URL` (адрес заглушки) и база из `.env.e2e`. Печатает итог одной строкой JSON.
 */

config({ quiet: true });

if (!process.env.CLOUD_STUB_GOOGLE_URL || process.env.NODE_ENV === "production") {
  console.error("Нужен CLOUD_STUB_GOOGLE_URL (заглушка) и не production");
  process.exit(2);
}

const [projectId, actorUserId, target] = process.argv.slice(2);
if (!projectId || !actorUserId || !target) {
  console.error("usage: <projectId> <actorUserId> common|<departmentId>");
  process.exit(2);
}

async function main() {
  // После `config()`: модули приложения читают переменные окружения при загрузке.
  const { ensureProjectDriveFolder } = await import("@/features/cloud/lib/project-drive-folders");
  const { prisma } = await import("@/shared/db/prisma");
  try {
    const result = await ensureProjectDriveFolder(
      projectId,
      target === "common" ? { kind: "common" } : { kind: "department", departmentId: target },
      actorUserId,
    );
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
