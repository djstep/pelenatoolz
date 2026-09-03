"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { updateProductionDayMetricsAction } from "@/features/reports/actions";
import { SceneFactModal } from "@/features/reports/components/scene-fact-modal";
import { WorkRowsSection } from "@/features/reports/components/work-rows-section";
import {
  factSecondsLabel,
  type ProductionReportBundle,
} from "@/features/reports/types";
import { productionSceneFactStatusLabels } from "@/features/reports/schemas";
import { formatPagesMinutes } from "@/features/schedule/lib/day-summary";
import {
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { formatDateLong } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useActionToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

export function ProductionReportWorkspace({
  locale,
  projectId,
  bundle,
  canEdit,
}: {
  locale: string;
  projectId: string;
  bundle: ProductionReportBundle;
  canEdit: boolean;
}) {
  const { day, project, report, cameraCount, factDuration } = bundle;
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);

  const [metrics, setMetrics] = useState({
    factShiftStart: report.factShiftStart ?? "",
    factShiftEnd: report.factShiftEnd ?? "",
    lunchStart: report.lunchStart ?? "",
    lunchEnd: report.lunchEnd ?? "",
    breakNotes: report.breakNotes ?? "",
    notes: report.notes ?? "",
  });

  const bound = updateProductionDayMetricsAction.bind(null, projectId, day.id);
  const [state, formAction, pending] = useActionState(bound, {});
  useActionToast(state);

  const selectedFact =
    report.sceneFacts.find((f) => f.id === selectedFactId) ?? null;

  const activeFacts = report.sceneFacts.filter((f) => !f.returnedToPool);
  const historyFacts = report.sceneFacts.filter((f) => f.returnedToPool);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/reports`}
              className="hover:text-white"
            >
              ← Все отчёты
            </Link>
            {" · "}
            <Link
              href={`/${locale}/projects/${projectId}/schedule`}
              className="hover:text-white"
            >
              КПП
            </Link>
            {" · "}
            <Link
              href={`/${locale}/projects/${projectId}/call-sheets/${day.id}`}
              className="hover:text-white"
            >
              Вызывной
            </Link>
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Производственный отчёт · День {day.dayNumber}
          </h2>
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h1 className="font-display text-xl font-semibold">
          {project.fullName || project.name}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          {formatDateLong(day.date)}
          {project.city ? ` · ${project.city}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{shootDayTypeLabels[day.dayType]}</Badge>
          <Badge>{shootDayStatusLabels[day.status]}</Badge>
          {day.isNightShift ? <Badge>Ночная смена</Badge> : null}
          {factDuration ? <Badge>Факт смены {factDuration}</Badge> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h3 className="mb-3 font-semibold">Общие показатели дня</h3>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Факт · начало смены</span>
              <HhMmInput
                value={metrics.factShiftStart}
                disabled={!canEdit}
                onChange={(factShiftStart) =>
                  setMetrics((p) => ({ ...p, factShiftStart }))
                }
                placeholder="08:00"
              />
              <input
                type="hidden"
                name="factShiftStart"
                value={metrics.factShiftStart}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Факт · конец смены</span>
              <HhMmInput
                value={metrics.factShiftEnd}
                disabled={!canEdit}
                onChange={(factShiftEnd) =>
                  setMetrics((p) => ({ ...p, factShiftEnd }))
                }
                placeholder="20:00"
              />
              <input
                type="hidden"
                name="factShiftEnd"
                value={metrics.factShiftEnd}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Обед · начало</span>
              <HhMmInput
                value={metrics.lunchStart}
                disabled={!canEdit}
                onChange={(lunchStart) =>
                  setMetrics((p) => ({ ...p, lunchStart }))
                }
              />
              <input type="hidden" name="lunchStart" value={metrics.lunchStart} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Обед · конец</span>
              <HhMmInput
                value={metrics.lunchEnd}
                disabled={!canEdit}
                onChange={(lunchEnd) => setMetrics((p) => ({ ...p, lunchEnd }))}
              />
              <input type="hidden" name="lunchEnd" value={metrics.lunchEnd} />
            </label>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <Label htmlFor="breakNotes">Перерывы / обед (комментарий)</Label>
              <Input
                id="breakNotes"
                name="breakNotes"
                disabled={!canEdit}
                value={metrics.breakNotes}
                onChange={(e) =>
                  setMetrics((p) => ({ ...p, breakNotes: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="dayNotes">Примечание по дню</Label>
              <Input
                id="dayNotes"
                name="notes"
                disabled={!canEdit}
                value={metrics.notes}
                onChange={(e) =>
                  setMetrics((p) => ({ ...p, notes: e.target.value }))
                }
              />
            </div>
          </div>
          {canEdit ? (
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Сохранение…" : "Сохранить показатели дня"}
            </Button>
          ) : null}
          {factDuration ? (
            <p className="text-sm text-[var(--muted-fg)]">
              Продолжительность смены (колонка «Факт» в списке):{" "}
              <strong className="text-foreground">{factDuration}</strong>
            </p>
          ) : null}
        </form>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h3 className="mb-1 font-semibold">Информация о съёмках</h3>
        <p className="mb-4 text-sm text-[var(--muted-fg)]">
          Сцены дня из КПП. Нажмите строку, чтобы ввести факт.
        </p>

        {activeFacts.length === 0 && historyFacts.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            В дне нет сцен. Назначьте их в КПП.
          </p>
        ) : (
          <SceneFactsTable
            facts={activeFacts}
            onOpen={(id) => setSelectedFactId(id)}
          />
        )}

        {historyFacts.length > 0 ? (
          <div className="mt-6">
            <h4 className="mb-2 text-sm font-semibold text-[var(--muted-fg)]">
              История · возвращены в неспланированные
            </h4>
            <SceneFactsTable
              facts={historyFacts}
              onOpen={(id) => setSelectedFactId(id)}
              muted
            />
          </div>
        ) : null}
      </section>

      <WorkRowsSection
        rows={report.workRows}
        projectId={projectId}
        dayId={day.id}
        canEdit={canEdit}
      />

      <SceneFactModal
        open={Boolean(selectedFact)}
        onClose={() => setSelectedFactId(null)}
        projectId={projectId}
        dayId={day.id}
        fact={selectedFact}
        cameraCount={cameraCount}
        canEdit={canEdit}
      />
    </div>
  );
}

function SceneFactsTable({
  facts,
  onOpen,
  muted,
}: {
  facts: ProductionReportBundle["report"]["sceneFacts"];
  onOpen: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-2 pr-3">Сцена</th>
            <th className="py-2 pr-3">План</th>
            <th className="py-2 pr-3">Факт хрон.</th>
            <th className="py-2 pr-3">Статус</th>
            <th className="py-2 pr-3">Мотор</th>
            <th className="py-2">Монтаж</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((fact) => (
            <tr
              key={fact.id}
              className={cn(
                "cursor-pointer border-b border-[var(--border)]/60 hover:bg-white/5",
                muted && "opacity-70",
              )}
              onClick={() => onOpen(fact.id)}
            >
              <td className="py-2 pr-3 font-medium">
                {fact.sceneLabel ||
                  `${fact.scene.number}${fact.scene.postfix || ""}`}
              </td>
              <td className="py-2 pr-3 text-[var(--muted-fg)]">
                {formatPagesMinutes(
                  fact.scene.pageCount,
                  fact.scene.planSeconds,
                )}
              </td>
              <td className="py-2 pr-3">{factSecondsLabel(fact.factSeconds)}</td>
              <td className="py-2 pr-3">
                <Badge>
                  {productionSceneFactStatusLabels[fact.status]}
                </Badge>
              </td>
              <td className="py-2 pr-3 text-[var(--muted-fg)]">
                {[fact.motorStart, fact.motorEnd].filter(Boolean).join(" – ") ||
                  "—"}
              </td>
              <td className="py-2 text-[var(--muted-fg)]">
                {fact.montageRows.length > 0
                  ? `${fact.montageRows.length} стр.`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
