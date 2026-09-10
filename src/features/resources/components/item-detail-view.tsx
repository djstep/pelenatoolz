"use client";

import Link from "next/link";
import type { ProjectType } from "@prisma/client";
import {
  OVERTIME_MODE_LABELS,
  UNPAID_OT_MODE_LABELS,
  type OvertimeCalcMode,
  type UnpaidOvertimeMode,
} from "@/features/reports/lib/compute-work-pay";
import { resourceCategoryPath } from "@/features/resources/lib/paths";
import type { ResourceItemDetail } from "@/features/resources/queries";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { formatMinutesHhMm, formatSecondsMmSs } from "@/shared/i18n/domain-labels";

export function ItemDetailView({
  projectId,
  locale,
  projectType,
  item,
  canFinanceRead = false,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  item: ResourceItemDetail;
  canFinanceRead?: boolean;
  /** @deprecated detail moved to /resource-usage */
  overtimeHistory?: unknown;
  canEdit?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={resourceCategoryPath(locale, projectId, item.categoryId)}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← {item.category.name}
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold">{item.name}</h1>
        {item.notes ? (
          <p className="mt-2 text-sm text-[var(--muted-fg)] whitespace-pre-wrap">
            {item.notes}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="glass-card p-4">
          <p className="text-xs text-[var(--muted-fg)]">Сцен</p>
          <p className="text-2xl font-semibold">{item.sceneCount}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-[var(--muted-fg)]">Не снято сцен</p>
          <p className="text-2xl font-semibold">{item.unshotSceneCount}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-[var(--muted-fg)]">Хрон (план)</p>
          <p className="text-2xl font-semibold">
            {item.planSeconds > 0 ? formatSecondsMmSs(item.planSeconds) : "—"}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-[var(--muted-fg)]">Хрон не снят</p>
          <p className="text-2xl font-semibold">
            {item.unshotSeconds > 0 ? formatSecondsMmSs(item.unshotSeconds) : "—"}
          </p>
        </div>
      </div>

      {canFinanceRead ? (
        <section className="glass-card p-5">
          <h2 className="mb-3 font-semibold">Финансовые условия</h2>
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-fg)]">Стоимость смены</dt>
              <dd>{item.shiftRate ?? "—"}</dd>
            </div>
            {item.category.tracksMileage ? (
              <div>
                <dt className="text-[var(--muted-fg)]">Ставка за км</dt>
                <dd>{item.kmRate ?? "—"}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[var(--muted-fg)]">Налог %</dt>
              <dd>{item.taxPercent ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-fg)]">Длительность смены</dt>
              <dd>
                {item.shiftHoursMin != null
                  ? formatMinutesHhMm(item.shiftHoursMin)
                  : "12:00"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-fg)]">Неоплач. переработка</dt>
              <dd>
                {item.unpaidOvertimeMin != null
                  ? formatMinutesHhMm(item.unpaidOvertimeMin)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-fg)]">Режим переработки</dt>
              <dd>
                {OVERTIME_MODE_LABELS[
                  (item.overtimeMode ?? "HOURLY_CUMULATIVE") as OvertimeCalcMode
                ]}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-fg)]">Учёт неоплач. буфера</dt>
              <dd>
                {
                  UNPAID_OT_MODE_LABELS[
                    (item.unpaidOvertimeMode ??
                      "FIRST_HOUR") as UnpaidOvertimeMode
                  ]
                }
              </dd>
            </div>
            {item.arrivalOffsetMin != null ? (
              <div>
                <dt className="text-[var(--muted-fg)]">Смещение прибытия</dt>
                <dd>{formatMinutesHhMm(item.arrivalOffsetMin)}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="glass-card p-5">
        <h2 className="mb-3 font-semibold">Ведомость по использованию</h2>
        <p className="mb-3 text-sm text-[var(--muted-fg)]">
          Детализация смен, переработок и доп. выплат по проекту.
        </p>
        <Link
          href={`/${locale}/projects/${projectId}/resource-usage/resources/${item.id}`}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Открыть ведомость →
        </Link>
      </section>

      {item.sceneLinks.length > 0 ? (
        <section className="glass-card p-5">
          <h2 className="mb-3 font-semibold">Сцены</h2>
          <ul className="space-y-2 text-sm">
            {item.sceneLinks.map((link) => (
              <li key={link.id}>
                <Link
                  href={`/${locale}/projects/${projectId}/libretto/${link.scene.id}`}
                  className="hover:underline"
                >
                  {formatSceneNumber(link.scene, projectType)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
