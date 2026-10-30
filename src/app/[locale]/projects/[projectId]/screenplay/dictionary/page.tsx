import { DictionaryList } from "@/features/import/components/dictionary-list";
import type { DictionaryRule } from "@/features/import/normalize/dictionary";
import { staleDictionaryRules } from "@/features/import/normalize/normalize-script";
import { ruleText } from "@/features/import/review/question-text";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

/** Словарь сценария проекта. Открытие ничего не пишет; удаление — с правом правки. */
export default async function ScriptDictionaryPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сценарию</p>;
  }

  const [rules, characters, locations] = await Promise.all([
    prisma.scriptDictionaryRule.findMany({
      where: { projectId },
      select: {
        id: true,
        type: true,
        key: true,
        answer: true,
        targetCharacterId: true,
        targetLocationId: true,
        createdAt: true,
      },
      orderBy: [{ type: "asc" }, { key: "asc" }],
    }),
    prisma.character.findMany({ where: { projectId }, select: { id: true, name: true } }),
    prisma.location.findMany({
      where: { projectId },
      select: { id: true, name: true, sublocation: true },
    }),
  ]);

  const existing = { characters, locations };
  const asRule = (rule: (typeof rules)[number]): DictionaryRule => ({
    type: rule.type,
    key: rule.key,
    answer: rule.answer,
    target: rule.targetCharacterId
      ? { kind: "character", id: rule.targetCharacterId }
      : rule.targetLocationId
        ? { kind: "location", id: rule.targetLocationId }
        : null,
  });
  const stale = new Set(
    staleDictionaryRules(rules.map(asRule), existing).map((r) => `${r.type}:${r.key}`),
  );
  const rows = rules.map((rule) => ({
    id: rule.id,
    text: ruleText({ type: rule.type, subject: rule.key, answer: rule.answer }, existing),
    stale: stale.has(`${rule.type}:${rule.key}`),
    createdAt: rule.createdAt.toLocaleDateString("ru-RU"),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-semibold">Словарь сценария</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Ответы на постоянные вопросы импорта: при следующих импортах и обновлении либретто
          они применяются молча. Удалите правило — вопрос задастся снова.
        </p>
      </div>
      <DictionaryList projectId={projectId} rows={rows} canWrite={ctx.can("script:write")} />
    </div>
  );
}
