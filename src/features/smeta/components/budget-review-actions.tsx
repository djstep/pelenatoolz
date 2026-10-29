"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { approveBudgetAction, returnBudgetAction } from "@/features/smeta/actions";
import { BudgetCommentModal } from "@/features/smeta/components/budget-comment-modal";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useToast } from "@/shared/ui/toast";

/**
 * «Утвердить» и «Вернуть» для продюсера на экране сравнения. Утверждение передаёт ревизию,
 * которую продюсер видит на экране: если глава успел сохранить — сервер откажет.
 */
export function BudgetReviewActions({
  projectId,
  departmentId,
  revision,
  nextNumber,
  canApproveNow,
  canReturn,
  versionsHref,
}: {
  projectId: string;
  departmentId: string;
  revision: number;
  nextNumber: number;
  canApproveNow: boolean;
  canReturn: boolean;
  versionsHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [returnOpen, setReturnOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canApproveNow ? (
        <Button
          type="button"
          onClick={() =>
            void confirm({
              title: `Создать версию ${nextNumber}?`,
              details: [
                "Отменить нельзя: версия не изменяется и не удаляется.",
                "Она станет планом цеха.",
              ],
              confirmLabel: "Утвердить",
              action: async () => {
                const result = await approveBudgetAction(projectId, departmentId, { revision });
                if (result.error) return result.error;
                toast.success(result.success ?? "Утверждено");
                router.push(`${versionsHref}/${result.number}`);
              },
            })
          }
        >
          Утвердить
        </Button>
      ) : null}
      {canReturn ? (
        <Button type="button" variant="secondary" onClick={() => setReturnOpen(true)}>
          Вернуть главе
        </Button>
      ) : null}

      <BudgetCommentModal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Вернуть смету главе"
        description="Глава увидит комментарий над листом сметы и в списке смет."
        label="Что исправить *"
        required
        submitLabel="Вернуть"
        onSubmit={async (comment) => {
          const result = await returnBudgetAction(projectId, departmentId, { comment });
          if (result.error) return result.error;
          toast.success(result.success ?? "Возвращено");
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}
