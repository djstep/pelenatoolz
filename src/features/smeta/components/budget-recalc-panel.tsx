"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveAllVariableRecalcAction, approveVariableRecalcAction } from "@/features/smeta/actions";
import type { RecalcCandidateInfo } from "@/features/smeta/approval-queries";
import { formatMoney } from "@/features/smeta/lib/line-draft";
import type { VariableChange } from "@/features/smeta/lib/items-snapshot";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useToast } from "@/shared/ui/toast";

function valueText(value: string | null): string {
  return value == null ? "не задана" : value.replace(".", ",");
}

export function variableChangesText(changes: readonly VariableChange[]): string {
  return changes.map((c) => `${c.label} ${valueText(c.before)} → ${valueText(c.after)}`).join(", ");
}

/** Кнопка «Утвердить пересчёт» для одной сметы (экран сметы цеха). */
export function ApproveRecalcButton({
  projectId,
  candidate,
}: {
  projectId: string;
  candidate: RecalcCandidateInfo;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <Button
      type="button"
      className="h-8"
      onClick={() =>
        void confirm({
          title: `Утвердить пересчёт — версия ${candidate.versionNumber + 1}?`,
          details: [
            `Строки не менялись, изменились переменные: ${variableChangesText(candidate.changes)}.`,
            `Итого: ${formatMoney(candidate.totalBefore)} → ${formatMoney(candidate.totalAfter)}.`,
            "Версия будет с пометкой «пересчёт по переменным», без отправки главой. Отменить нельзя.",
          ],
          confirmLabel: "Утвердить пересчёт",
          tone: "primary",
          action: async () => {
            const result = await approveVariableRecalcAction(projectId, candidate.departmentId, {
              fingerprint: candidate.fingerprint,
            });
            if (result.error) return result.error;
            toast.success(result.success ?? "Утверждено");
            router.refresh();
          },
        })
      }
    >
      Утвердить пересчёт
    </Button>
  );
}

/**
 * Сметы, ушедшие в черновик только из-за смены переменных (строки главой не менялись): продюсер
 * утверждает пересчёт сам — по одной или все сразу. Каждая — со своим отпечатком с экрана.
 */
export function BudgetRecalcPanel({
  projectId,
  candidates,
  smetaHref,
}: {
  projectId: string;
  candidates: readonly RecalcCandidateInfo[];
  /** Адрес списка смет: смета цеха — «<smetaHref>/<id цеха>». */
  smetaHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  if (candidates.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-xl border border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] px-4 py-3 text-sm"
      data-recalc-panel
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Пересчитаны после смены переменных — строки главами не менялись</h3>
        <Button
          type="button"
          className="ml-auto h-8"
          onClick={() =>
            void confirm({
              title: `Утвердить все пересчитанные (${candidates.length})?`,
              details: [
                "Для каждой сметы — новая версия с пометкой «пересчёт по переменным», без отправки главой.",
                "Отменить нельзя.",
              ],
              confirmLabel: "Утвердить все",
              tone: "primary",
              action: async () => {
                const result = await approveAllVariableRecalcAction(projectId, {
                  items: candidates.map((c) => ({ departmentId: c.departmentId, fingerprint: c.fingerprint })),
                });
                if (result.failed && result.failed.length > 0) toast.error(result.failed.join("; "));
                if (result.success) toast.success(result.success);
                router.refresh();
                return result.approved ? undefined : (result.error ?? "Ничего не утверждено");
              },
            })
          }
        >
          Утвердить все пересчитанные ({candidates.length})
        </Button>
      </div>
      <ul className="divide-y divide-[var(--border)]/60">
        {candidates.map((c) => (
          <li key={c.departmentId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" data-recalc-department={c.departmentName}>
            <Link href={`${smetaHref}/${c.departmentId}`} className="font-medium hover:underline">
              {c.departmentName}
            </Link>
            <span>{variableChangesText(c.changes)}</span>
            <span className="tabular-nums">
              {formatMoney(c.totalBefore)} → <b>{formatMoney(c.totalAfter)}</b>
            </span>
            <span className="ml-auto">
              <ApproveRecalcButton projectId={projectId} candidate={c} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
