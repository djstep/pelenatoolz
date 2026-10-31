"use client";

import { useRouter } from "next/navigation";
import { deleteDictionaryRuleAction } from "@/features/import/dictionary-actions";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useToast } from "@/shared/ui/toast";

export type DictionaryRow = {
  id: string;
  /** «Похожие персонажи: МАРИЯ ~ МАРИНА → разные». */
  text: string;
  stale: boolean;
  createdAt: string;
};

/** Правила словаря проекта. Удаление — только с правом правки, с подтверждением. */
export function DictionaryList({
  projectId,
  rows,
  canWrite,
}: {
  projectId: string;
  rows: DictionaryRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  function remove(row: DictionaryRow) {
    void confirm({
      title: "Удалить правило словаря?",
      details: [
        row.text,
        "При следующем импорте или обновлении либретто этот вопрос задастся снова.",
      ],
      confirmLabel: "Удалить",
      action: async () => {
        const result = await deleteDictionaryRuleAction(projectId, row.id);
        if (result.error) return result.error;
        toast.success(result.success ?? "Правило удалено");
        router.refresh();
      },
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-fg)]">
        Словарь пуст. Правила появляются из ответов на постоянные вопросы при импорте сценария.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-[var(--border)] text-xs text-[var(--muted-fg)]">
          <tr>
            <th className="px-3 py-2">Правило</th>
            <th className="px-3 py-2">Дата</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--border)]/50 align-top">
              <td className="px-3 py-2">
                <span className={row.stale ? "text-[var(--muted-fg)]" : ""}>{row.text}</span>
                {row.stale ? (
                  <Badge className="ml-2 text-[var(--tone-warning)]">
                    устарело: запись удалена, правило не применяется
                  </Badge>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-fg)]">
                {row.createdAt}
              </td>
              <td className="px-3 py-2 text-right">
                {canWrite ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    onClick={() => remove(row)}
                  >
                    Удалить
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
