export function financeCounterpartyLabel(op: {
  counterparty: string | null;
  company?: { name: string } | null;
  counterpartyEntity?: { name: string } | null;
}) {
  return (
    op.counterpartyEntity?.name ??
    op.counterparty ??
    op.company?.name ??
    null
  );
}
