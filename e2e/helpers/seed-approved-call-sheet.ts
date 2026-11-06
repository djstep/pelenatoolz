import "./use-e2e-database";
import { createRequire } from "node:module";
import { config } from "dotenv";
import type { Prisma } from "@prisma/client";

/**
 * Для сида: первая утверждённая версия вызывного дня, как после «Утвердить» и «Внести изменения»:
 * снимок настоящей сборкой листа, сам вызывной — черновик следующей версии. Без неё `e2e:drive`
 * зависел бы от утверждения в `c1-flows`. Запуск из `scripts/e2e-seed.ts`:
 *   node --import tsx e2e/helpers/seed-approved-call-sheet.ts <projectId> <dayId> <userId>
 */

config({ quiet: true });

// Сборка листа тянет `next/navigation`, а он не работает с условием react-server, поэтому
// запуск обычный, и защиту `server-only` здесь отключаем: этот процесс и так серверный.
const nodeRequire = createRequire(__filename);
const serverOnly = nodeRequire.resolve("server-only");
nodeRequire.cache[serverOnly] = { exports: {} } as NodeJS.Module;

const [projectId, dayId, userId] = process.argv.slice(2);
if (!projectId || !dayId || !userId) {
  console.error("usage: <projectId> <dayId> <userId>");
  process.exit(2);
}

async function main() {
  // После `config()`: модули приложения читают переменные окружения при загрузке.
  const { buildLiveCallSheet } = await import("@/features/call-sheets/print/load-print-model");
  const { prisma } = await import("@/shared/db/prisma");
  try {
    const live = await buildLiveCallSheet(projectId!, dayId!);
    if (!live) throw new Error("день не найден");
    await prisma.$transaction(async (tx) => {
      const sheet = await tx.callSheet.findUniqueOrThrow({
        where: { shootDayId: dayId },
        select: { id: true, version: true },
      });
      await tx.callSheetApprovedVersion.create({
        data: {
          callSheetId: sheet.id,
          version: sheet.version,
          approvedById: userId,
          snapshot: live.model as unknown as Prisma.InputJsonValue,
          modelHash: live.dataHash,
        },
      });
      await tx.callSheet.update({ where: { id: sheet.id }, data: { version: sheet.version + 1 } });
    });
  } catch (e) {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
