/**
 * Чистка уже сохранённых `ScriptBlock.contentHtml` (волна 2б, задача 6): та же очистка, что
 * при записи (`sanitizeBlockHtml`). Без флага — пробный прогон: ничего не пишет, показывает
 * числа по проектам и версиям и до 5 примеров «было → стало» (только фрагмент вокруг изменения).
 * С `--write` — записывает. Повторный запуск ничего не меняет.
 *
 *   npx tsx scripts/clean-script-block-html.ts
 *   npx tsx scripts/clean-script-block-html.ts --write
 */
import "dotenv/config";
import { sanitizeBlockHtml } from "../src/features/screenplay/lib/safe-block-html";
import { prisma } from "../src/shared/db/prisma";

const WRITE = process.argv.includes("--write");
const EXAMPLES = 5;
const AROUND = 30;

/** Фрагмент вокруг первого отличия — без текста блока целиком. */
function fragment(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const from = Math.max(0, start - AROUND);
  const cut = (text: string, end: number) =>
    `${from > 0 ? "…" : ""}${text.slice(from, end + AROUND)}${end + AROUND < text.length ? "…" : ""}`;
  return { before: cut(before, endBefore), after: cut(after, endAfter) };
}

async function main() {
  const rows = await prisma.scriptBlock.findMany({
    where: { contentHtml: { not: null } },
    select: {
      id: true,
      contentHtml: true,
      project: { select: { name: true } },
      scriptVersion: { select: { versionNumber: true, title: true } },
    },
    orderBy: [{ projectId: "asc" }, { scriptVersionId: "asc" }, { sortOrder: "asc" }],
  });

  const changes = rows
    .map((row) => ({ row, next: sanitizeBlockHtml(row.contentHtml) }))
    .filter(({ row, next }) => next !== row.contentHtml);

  console.log(WRITE ? "Режим: запись" : "Режим: пробный прогон (без записи)");
  console.log(`Блоков с contentHtml: ${rows.length}. Изменится: ${changes.length}.`);

  const byVersion = new Map<string, { changed: number; toNull: number }>();
  for (const { row, next } of changes) {
    const title = row.scriptVersion.title?.trim();
    const key = `«${row.project.name}» · версия ${row.scriptVersion.versionNumber}${title ? ` «${title}»` : ""}`;
    const stat = byVersion.get(key) ?? { changed: 0, toNull: 0 };
    stat.changed++;
    if (next === null) stat.toNull++;
    byVersion.set(key, stat);
  }
  for (const [key, stat] of byVersion) {
    console.log(`  ${key}: изменится ${stat.changed}, из них станет пусто (null) ${stat.toNull}`);
  }

  for (const { row, next } of changes.slice(0, EXAMPLES)) {
    const shown = fragment(row.contentHtml ?? "", next ?? "");
    console.log(`\nБлок ${row.id}:`);
    console.log(`  было:  ${JSON.stringify(shown.before)}`);
    console.log(`  стало: ${next === null ? "null" : JSON.stringify(shown.after)}`);
  }

  if (!WRITE || changes.length === 0) return;

  let written = 0;
  for (const { row, next } of changes) {
    // Только если блок не изменился с момента чтения.
    const result = await prisma.scriptBlock.updateMany({
      where: { id: row.id, contentHtml: row.contentHtml },
      data: { contentHtml: next },
    });
    written += result.count;
  }
  console.log(`\nЗаписано: ${written} из ${changes.length}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
