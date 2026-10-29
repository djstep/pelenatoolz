import type { BudgetStatus } from "@prisma/client";
import { Badge, statusBadgeStyle } from "@/shared/ui/badge";

const LABELS: Record<BudgetStatus, string> = {
  DRAFT: "Черновик",
  SUBMITTED: "На утверждении",
  RETURNED: "Возвращена",
  APPROVED: "Утверждена",
};

const COLORS: Record<BudgetStatus, string> = {
  DRAFT: "var(--tone-neutral)",
  SUBMITTED: "var(--tone-info)",
  RETURNED: "var(--tone-danger)",
  APPROVED: "var(--tone-success)",
};

/** Статус сметы цеха. «Изменена после отправки» — черновик, который ждёт продюсер. */
export function SmetaStatusBadge({
  status,
  changedAfterSubmit = false,
  versionNumber = null,
}: {
  status: BudgetStatus;
  changedAfterSubmit?: boolean;
  versionNumber?: number | null;
}) {
  const changed = status === "DRAFT" && changedAfterSubmit;
  const label = changed
    ? "Изменена после отправки"
    : status === "APPROVED" && versionNumber
      ? `Утверждена · версия ${versionNumber}`
      : LABELS[status];
  return (
    <Badge
      className="status-badge whitespace-nowrap"
      style={statusBadgeStyle(changed ? "var(--tone-warning)" : COLORS[status])}
    >
      {label}
    </Badge>
  );
}
