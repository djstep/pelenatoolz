"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshProductionReportAction } from "@/features/reports/actions";
import type { ReportStaleness } from "@/features/reports/queries";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Отчёта ещё нет — «Создать из КПП». Открытие страницы его не создаёт.
 */
export function ReportCreatePanel({
  projectId,
  shootDayId,
  canEdit,
}: {
  projectId: string;
  shootDayId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
      <h3 className="font-semibold">Отчёт ещё не создан</h3>
      {canEdit ? (
        <>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Сцены, люди, ресурсы и объекты дня возьмутся из КПП и вызывного, ставки — из карточек.
            По оплате в отчёте создадутся начисления.
          </p>
          <Button
            type="button"
            className="mt-4"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await refreshProductionReportAction(projectId, shootDayId, {
                  create: true,
                  updateRates: true,
                });
                if (res.error) {
                  toast.error(res.error);
                  return;
                }
                toast.success(res.success ?? "Отчёт создан");
                router.refresh();
              })
            }
          >
            {pending ? "Создание…" : "Создать из КПП"}
          </Button>
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Отчёт ещё не заполнен. Его создаёт тот, кто ведёт производственные отчёты.
        </p>
      )}
    </section>
  );
}

/**
 * «Отчёт устарел, обновить?» — что изменит «Обновить из КПП». Строки добавляются и убираются
 * всегда; ставки, налог и режимы существующих строк — только с галочкой.
 */
export function ReportStalePanel({
  projectId,
  shootDayId,
  staleness,
  canEdit,
}: {
  projectId: string;
  shootDayId: string;
  staleness: ReportStaleness;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [updateRates, setUpdateRates] = useState(false);
  const { rows, accruals } = staleness;

  const lines = [
    staleness.scenesAdded.length
      ? `новые сцены: ${staleness.scenesAdded.join(", ")}`
      : "",
    staleness.scenesChanged
      ? `у ${staleness.scenesChanged} ${plural(staleness.scenesChanged, "сцены", "сцен", "сцен")} сменились порядок или подпись`
      : "",
    rows.added.length ? `добавятся строки: ${rows.added.join(", ")}` : "",
    rows.removed.length
      ? `уберутся строки (их начисления станут 0): ${rows.removed.join(", ")}`
      : "",
    rows.otherChanged.length
      ? `обновятся название, время из вызывного или оплата: ${rows.otherChanged.join(", ")}`
      : "",
    accruals.created + accruals.updated + accruals.zeroed
      ? `начисления: ${[
          accruals.created ? `создать ${accruals.created}` : "",
          accruals.updated ? `обновить ${accruals.updated}` : "",
          accruals.zeroed ? `обнулить ${accruals.zeroed}` : "",
        ]
          .filter(Boolean)
          .join(", ")}`
      : "",
  ].filter(Boolean);

  return (
    <section className="rounded-2xl border border-[var(--tone-warning)] bg-[var(--tone-warning-bg)] p-5 print:hidden">
      <h3 className="font-semibold text-[var(--tone-warning)]">Отчёт устарел, обновить?</h3>
      <p className="mt-1 text-sm text-[var(--muted-fg)]">
        В КПП, вызывном или карточках есть изменения, которых нет в отчёте. Пока отчёт не
        обновлён, в нём и в начислениях — прежние данные.
      </p>
      {lines.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {rows.rateChanges.length ? (
        <div className="mt-4 space-y-2">
          {canEdit ? (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={updateRates}
                onChange={(e) => setUpdateRates(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Обновить ставки из карточек
            </label>
          ) : (
            <p className="text-sm font-medium">Ставки в карточках отличаются от отчёта</p>
          )}
          <p className="text-xs text-[var(--muted-fg)]">
            Без галочки существующие строки остаются со своими ставками, налогом и режимами.
          </p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel-solid)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="px-3 py-2">Строка</th>
                  <th className="px-3 py-2">Что</th>
                  <th className="px-3 py-2">Было</th>
                  <th className="px-3 py-2">Станет</th>
                </tr>
              </thead>
              <tbody>
                {rows.rateChanges.flatMap((change) => [
                  ...change.fields.map((field, index) => (
                    <tr
                      key={`${change.rowId}-${field.label}`}
                      className="border-b border-[var(--border)]/60"
                    >
                      <td className="px-3 py-2 font-medium">
                        {index === 0 ? change.name : ""}
                      </td>
                      <td className="px-3 py-2">{field.label}</td>
                      <td className="px-3 py-2">{field.before}</td>
                      <td className="px-3 py-2">{field.after}</td>
                    </tr>
                  )),
                  <tr
                    key={`${change.rowId}-pay`}
                    className="border-b border-[var(--border)]/60 text-[var(--muted-fg)]"
                  >
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Оплата с налогом</td>
                    <td className="px-3 py-2">{change.pay.before}</td>
                    <td className="px-3 py-2">{change.pay.after}</td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <Button
          type="button"
          className="mt-4"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await refreshProductionReportAction(projectId, shootDayId, {
                create: false,
                updateRates,
              });
              if (res.error) {
                toast.error(res.error);
                return;
              }
              toast.success(res.success ?? "Отчёт обновлён");
              router.refresh();
            })
          }
        >
          {pending ? "Обновление…" : "Обновить из КПП"}
        </Button>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted-fg)]">
          Обновить отчёт может тот, кто ведёт производственные отчёты.
        </p>
      )}
    </section>
  );
}
