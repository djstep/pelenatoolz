"use client";

import Link from "next/link";
import type { ProductionSceneFactStatus } from "@prisma/client";
import { productionSceneFactStatusLabels } from "@/features/reports/schemas";
import { productionSceneFactStatusColors } from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";

export type ScenePlanningAttempt = {
  id: string;
  shootDate: string | Date;
  status: ProductionSceneFactStatus;
  shootDay: { id: string; dayNumber: number; unit: string | null };
};

export function ScenePlanningHistory({
  locale,
  projectId,
  attempts,
}: {
  locale: string;
  projectId: string;
  attempts: ScenePlanningAttempt[];
}) {
  return (
    <aside className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
      <h3 className="font-display text-sm font-semibold tracking-wide">
        История планирования
      </h3>
      <p className="mt-1 text-xs text-[var(--muted-fg)]">
        Попытки съёмки из производственного отчёта. Не зависят от текущего дня в
        КПП.
      </p>

      {attempts.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-fg)]">
          Записей пока нет — появятся после статуса в отчёте по дню.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {attempts.map((attempt) => {
            const label =
              productionSceneFactStatusLabels[attempt.status] ?? attempt.status;
            const color =
              productionSceneFactStatusColors[attempt.status] ?? "";
            return (
              <li
                key={attempt.id}
                className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {formatDateShort(attempt.shootDate)}
                    </p>
                    <p className="text-xs text-[var(--muted-fg)]">
                      Съёмочный день {attempt.shootDay.dayNumber}
                      {attempt.shootDay.unit &&
                      attempt.shootDay.unit !== "main"
                        ? ` · ${attempt.shootDay.unit}`
                        : ""}
                    </p>
                  </div>
                  <Badge className={cn(color)}>
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                  </Badge>
                </div>
                <Link
                  href={`/${locale}/projects/${projectId}/call-sheets/${attempt.shootDay.id}`}
                  className="mt-2 inline-block text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Вызывной →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
