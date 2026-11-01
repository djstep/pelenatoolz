"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  createCallSheetAction,
  refreshCallSheetFromTemplateAction,
} from "@/features/call-sheets/actions";
import type { CallSheetBlocks } from "@/features/call-sheets/queries";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { toast } from "@/shared/ui/toast";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-fg)]">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-[var(--muted-fg)]">—</p>;
}

/**
 * Вызывной дня: пока не создан — кнопка «Создать вызывной» (копия шаблона проекта);
 * создан — блоки из шаблона и «Обновить из шаблона».
 */
export function CallSheetTemplateBlocks({
  locale,
  projectId,
  dayId,
  callSheet,
  appliedAtLabel,
  canEdit,
}: {
  locale: string;
  projectId: string;
  dayId: string;
  callSheet: CallSheetBlocks | null;
  /** Когда блоки заполнены из шаблона — уже в часовом поясе проекта. */
  appliedAtLabel: string | null;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const templateHref = `/${locale}/projects/${projectId}/settings/call-sheet-template`;

  if (!callSheet) {
    return (
      <Card className="space-y-3">
        <p className="text-sm">
          Вызывной этого дня ещё не создан. Ниже — данные дня из КПП.
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await createCallSheetAction(projectId, dayId);
                  if (result.error) toast.error(result.error);
                  else toast.success("Вызывной создан");
                })
              }
            >
              {pending ? "…" : "Создать вызывной"}
            </Button>
            <p className="text-xs text-[var(--muted-fg)]">
              Руководители, цеха и база заполнятся из{" "}
              <Link href={templateHref} className="text-[var(--accent)] hover:underline">
                шаблона вызывного
              </Link>
              .
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-fg)]">
            Создать вызывной может участник с правом «КПП и вызывные: правка».
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-fg)]">
          Из шаблона: {appliedAtLabel}
        </p>
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void confirm({
                title: "Обновить вызывной из шаблона?",
                details: [
                  "Руководители, вызов цехов, база и транспорт заменятся строками шаблона.",
                  "Ручные правки этих блоков в вызывном пропадут.",
                ],
                confirmLabel: "Обновить",
                action: async () => {
                  const result = await refreshCallSheetFromTemplateAction(projectId, dayId);
                  if (result.error) return result.error;
                  toast.success("Вызывной обновлён из шаблона");
                },
              })
            }
          >
            Обновить из шаблона
          </Button>
        ) : null}
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <Block title="Руководители группы">
          {callSheet.leaders.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1 text-sm">
              {callSheet.leaders.map((row) => (
                <li key={row.id}>
                  <span className="font-medium">{row.shortTitle || row.position}</span>
                  {row.personName ? ` — ${row.personName}` : ""}
                  {row.phone ? (
                    <span className="text-[var(--muted-fg)]"> · {row.phone}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Block>
        <Block title="Цеха и вызов">
          {callSheet.crewCalls.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1 text-sm">
              {callSheet.crewCalls.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span>{row.label}</span>
                  <span className="tabular-nums text-[var(--muted-fg)]">{row.callTime ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
        <Block title="База и транспорт группы">
          {callSheet.baseItems.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1 text-sm">
              {callSheet.baseItems.map((row) => (
                <li
                  key={row.id}
                  className={
                    row.notNeeded
                      ? "flex justify-between gap-3 text-[var(--muted-fg)] line-through"
                      : "flex justify-between gap-3"
                  }
                >
                  <span>{row.name}</span>
                  <span className="tabular-nums">{row.notNeeded ? "не нужен" : (row.callTime ?? "—")}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </Card>
  );
}
