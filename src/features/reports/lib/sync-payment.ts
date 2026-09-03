import type { FinanceOpCategory } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

function categoryForKind(
  kind: "ACTOR" | "RESOURCE" | "TRANSPORT" | "LOCATION",
): FinanceOpCategory {
  switch (kind) {
    case "ACTOR":
      return "CAST_PAY";
    case "TRANSPORT":
      return "TRANSPORT";
    case "LOCATION":
      return "LOCATION";
    case "RESOURCE":
    default:
      return "EQUIPMENT";
  }
}

/** Upsert Payment from a work row (source for гонорары / actuals). */
export async function syncPaymentFromWorkRow(
  projectId: string,
  shootDayId: string,
  workRowId: string,
) {
  const [row, day] = await Promise.all([
    prisma.productionReportWorkRow.findUnique({
      where: { id: workRowId },
      include: { extras: true },
    }),
    prisma.shootDay.findFirst({
      where: { id: shootDayId, projectId },
      select: { date: true, dayNumber: true },
    }),
  ]);
  if (!row || !day) return;

  const amount = dec(row.totalPay);
  if (amount == null || amount === 0) {
    await prisma.payment.deleteMany({ where: { workRowId } });
    return;
  }

  const notesParts = [
    row.factOvertimeMin != null && row.factOvertimeMin > 0
      ? `переработка факт/опл.: ${row.factOvertimeMin}/${row.payableOvertimeMin ?? 0} мин`
      : null,
    row.lunchSkipped ? "Т/О" : null,
    row.extras.length > 0
      ? `доп. выплат: ${row.extras.length}`
      : null,
  ].filter(Boolean);

  await prisma.payment.upsert({
    where: { workRowId },
    create: {
      projectId,
      shootDayId,
      workRowId,
      actorId: row.actorId,
      resourceItemId: row.resourceItemId,
      category: categoryForKind(row.kind),
      title: `День ${day.dayNumber} · ${row.displayName}`,
      amount,
      paymentDate: day.date,
      notes: notesParts.join(" · ") || null,
    },
    update: {
      actorId: row.actorId,
      resourceItemId: row.resourceItemId,
      category: categoryForKind(row.kind),
      title: `День ${day.dayNumber} · ${row.displayName}`,
      amount,
      paymentDate: day.date,
      notes: notesParts.join(" · ") || null,
    },
  });
}
