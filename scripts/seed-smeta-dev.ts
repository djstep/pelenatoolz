/**
 * Сид сметы по статьям в dev-базе (волна «Смета по статьям», шаг 9): шаблон статей, два цеха со
 * сметами в новой модели (один — с утверждённой версией), переменные, формы оплаты, резерв и
 * агентские. Только локальная база `pelena_dev` из `.env`; другую — отказ. Повторный запуск
 * ничего не дублирует.
 *
 *   npx tsx scripts/seed-smeta-dev.ts --project <id проекта>
 *   npx tsx scripts/seed-smeta-dev.ts --list    — проекты dev-базы: id и название
 */
import "dotenv/config";
import { isLocalDatabase, LOCAL_DEV_DATABASE } from "../src/shared/db/seed-database-guard";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!isLocalDatabase(url, [LOCAL_DEV_DATABASE])) {
    throw new Error(`Только локальная база ${LOCAL_DEV_DATABASE} — сид не запущен`);
  }
  const { prisma } = await import("../src/shared/db/prisma");
  const { seedSmetaItems } = await import("./lib/seed-smeta-items");
  try {
    const args = process.argv.slice(2);
    if (args.includes("--list")) {
      const projects = await prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
      for (const p of projects) console.log(`${p.id}  ${p.name}`);
      return;
    }
    const projectId = args[args.indexOf("--project") + 1];
    if (!args.includes("--project") || !projectId) throw new Error("Укажите --project <id> (список — --list)");
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, ownerUserId: true } });
    if (!project) throw new Error("Проект не найден");
    const log = await seedSmetaItems(prisma, { projectId, producerUserId: project.ownerUserId });
    console.log(`Проект «${project.name}»`);
    if (log.length === 0) console.log("Сметы по статьям уже есть — ничего не добавлено");
    for (const line of log) console.log(`Смета по статьям — ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
