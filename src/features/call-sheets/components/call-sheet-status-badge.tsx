import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import { CALL_SHEET_STATUS_LABELS } from "@/features/call-sheets/print/stamp";
import { Badge, statusBadgeStyle } from "@/shared/ui/badge";

/** Цвет плашки статуса: черновик — серый, на согласовании — жёлтый, утверждён — зелёный. */
export const CALL_SHEET_STATUS_COLORS: Record<CallSheetStatusValue, string> = {
  DRAFT: "#a1a1aa",
  IN_REVIEW: "#eab308",
  APPROVED: "#22c55e",
};

/** Статус вызывного цветной плашкой — на странице вызывного и в списке вызывных. */
export function CallSheetStatusBadge({ status }: { status: CallSheetStatusValue }) {
  return (
    <Badge
      className="status-badge"
      style={statusBadgeStyle(CALL_SHEET_STATUS_COLORS[status])}
      data-status={status}
    >
      {CALL_SHEET_STATUS_LABELS[status]}
    </Badge>
  );
}
