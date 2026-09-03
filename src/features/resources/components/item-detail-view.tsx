"use client";

import Link from "next/link";
import type { ProjectType } from "@prisma/client";
import { resourceCategoryPath } from "@/features/resources/lib/paths";
import type { ResourceItemDetail } from "@/features/resources/queries";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { formatMinutesHhMm, formatSecondsMmSs } from "@/shared/i18n/domain-labels";

export function ItemDetailView({
  projectId,
  locale,
  projectType,
  item,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  item: ResourceItemDetail;
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

      {(item.shiftRate != null ||
        item.shiftHoursMin != null ||
        item.unpaidOvertimeMin != null) && (
        <section className="glass-card p-5">
          <h2 className="mb-3 font-semibold">Финансовые параметры</h2>
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-fg)]">Стоимость смены</dt>
              <dd>{item.shiftRate ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-fg)]">Длительность смены</dt>
              <dd>
                {item.shiftHoursMin != null
                  ? formatMinutesHhMm(item.shiftHoursMin)
                  : "—"}
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
            {item.arrivalOffsetMin != null ? (
              <div>
                <dt className="text-[var(--muted-fg)]">Смещение прибытия</dt>
                <dd>{formatMinutesHhMm(item.arrivalOffsetMin)}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      )}

      {item.sceneLinks.length > 0 ? (
        <section className="glass-card p-5">
          <h2 className="mb-3 font-semibold">Сцены</h2>
          <ul className="space-y-2 text-sm">
            {item.sceneLinks.map((link) => (
              <li key={link.id} className="border-b border-[var(--border)]/50 pb-2">
                <span className="font-medium">
                  {formatSceneNumber(
                    {
                      episodeNumber: link.scene.episodeNumber,
                      number: link.scene.number,
                      postfix: link.scene.postfix,
                    },
                    projectType,
                  )}
                </span>
                {link.quantity > 1 ? ` ×${link.quantity}` : ""}
                {link.scene.planSeconds
                  ? ` · ${formatSecondsMmSs(link.scene.planSeconds)}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
