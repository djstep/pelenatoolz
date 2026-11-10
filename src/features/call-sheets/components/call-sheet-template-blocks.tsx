"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createCallSheetAction,
  refreshCallSheetFromScheduleAction,
  refreshCallSheetFromTemplateAction,
} from "@/features/call-sheets/actions";
import {
  CallSheetSheetEditor,
  type SchemeLocationOption,
} from "@/features/call-sheets/components/call-sheet-sheet-editor";
import type { CallSheetBlocks, TemplateMemberOption } from "@/features/call-sheets/queries";
import { Button } from "@/shared/ui/button";
import { useCallSheetRevision } from "@/features/call-sheets/components/revision-context";
import { SheetBlock } from "@/features/call-sheets/components/sheet-block";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { toast } from "@/shared/ui/toast";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";
import { formatLocationTitle } from "@/features/locations/lib/format-location";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="sheet-subhead mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-[var(--muted-fg)]">—</p>;
}

/** «Обновить из КПП»: ресурсы смены заново из сцен дня. Открытие страницы ничего не пишет. */
function RefreshFromScheduleButton({ projectId, dayId }: { projectId: string; dayId: string }) {
  const confirm = useConfirm();
  const { revision, track } = useCallSheetRevision();
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() =>
        void confirm({
          title: "Обновить вызывной из КПП?",
          details: [
            "Ресурсы из сцен дня (реквизит, транспорт, групповка…) возьмутся заново из либретто и КПП.",
            "Ресурсов, которых больше нет в сценах дня, в вызывном не останется.",
            "Посменные ресурсы, добавленные руками, останутся.",
          ],
          confirmLabel: "Обновить",
          action: async () => {
            const result = track(
              await refreshCallSheetFromScheduleAction(projectId, dayId, revision),
            );
            if (result.error) return result.error;
            toast.success("Вызывной обновлён из КПП");
          },
        })
      }
    >
      Обновить из КПП
    </Button>
  );
}

function SheetText({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <Block title={title}>
      <p className="whitespace-pre-line text-sm">{text}</p>
    </Block>
  );
}

/**
 * Вызывной дня: пока не создан — кнопка «Создать вызывной» (копия шаблона проекта);
 * создан — поля листа и блоки, «Править вызывной», «Обновить из шаблона».
 * «Обновить из КПП» — в обоих случаях.
 */
export function CallSheetTemplateBlocks({
  locale,
  projectId,
  dayId,
  callSheet,
  appliedAtLabel,
  canEdit,
  members,
  departments,
  locations,
}: {
  locale: string;
  projectId: string;
  dayId: string;
  callSheet: CallSheetBlocks | null;
  /** Когда блоки заполнены из шаблона — уже в часовом поясе проекта. */
  appliedAtLabel: string | null;
  canEdit: boolean;
  members: TemplateMemberOption[];
  departments: { id: string; name: string }[];
  locations: SchemeLocationOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();
  const { revision, track } = useCallSheetRevision();
  const unsaved = useUnsavedChanges();
  const templateHref = `/${locale}/projects/${projectId}/settings/call-sheet-template`;

  if (!callSheet) {
    return (
      <SheetBlock title="Вызывной" className="space-y-3">
        <p className="text-sm">
          Вызывной этого дня ещё не создан. Ниже — данные дня из КПП.
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = track(await createCallSheetAction(projectId, dayId));
                  if (result.error) toast.error(result.error);
                  else toast.success("Вызывной создан");
                })
              }
            >
              {pending ? "…" : "Создать вызывной"}
            </Button>
            <RefreshFromScheduleButton projectId={projectId} dayId={dayId} />
            <p className="text-xs text-[var(--muted-fg)]">
              Руководители, цеха и база заполнятся из{" "}
              <Link href={templateHref} className="text-[var(--accent)] hover:underline">
                шаблона вызывного
              </Link>
              .
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-fg)]">
            Создать вызывной может участник с правом «КПП и вызывные: правка».
          </p>
        )}
      </SheetBlock>
    );
  }

  // «Закрыть» прячет форму — несохранённое в ней пропало бы.
  function closeEditor() {
    if (!unsaved.hasUnsaved()) {
      setEditing(false);
      return;
    }
    void unsaved.confirm().then((choice) => {
      if (choice === "discard") setEditing(false);
    });
  }

  const schemeLabel = callSheet.schemeLocation
    ? formatLocationTitle(callSheet.schemeLocation, ". ")
    : null;

  return (
    <SheetBlock title="Поля листа" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-fg)]">
          Из шаблона: {appliedAtLabel}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <Button type="button" variant="ghost" onClick={closeEditor}>
                Закрыть правку
              </Button>
            ) : (
              <Button type="button" onClick={() => setEditing(true)}>
                Править вызывной
              </Button>
            )}
            <RefreshFromScheduleButton projectId={projectId} dayId={dayId} />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void confirm({
                  title: "Обновить вызывной из шаблона?",
                  details: [
                    "Руководители, вызов цехов, база и транспорт заменятся строками шаблона.",
                    "Ручные правки этих блоков в вызывном пропадут.",
                  ],
                  confirmLabel: "Обновить",
                  action: async () => {
                    const result = track(
                      await refreshCallSheetFromTemplateAction(projectId, dayId, revision),
                    );
                    if (result.error) return result.error;
                    setEditing(false);
                    toast.success("Вызывной обновлён из шаблона");
                  },
                })
              }
            >
              Обновить из шаблона
            </Button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <CallSheetSheetEditor
          projectId={projectId}
          dayId={dayId}
          callSheet={callSheet}
          members={members}
          departments={departments}
          locations={locations}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-3">
            <Block title="Погода">
              <p className="text-sm">
                t днём: {callSheet.tempDay ?? "—"} · t ночью: {callSheet.tempNight ?? "—"}
              </p>
            </Block>
            <Block title="Объект схемы">
              <p className="text-sm">{schemeLabel ?? "—"}</p>
            </Block>
            <SheetText title="Важно" text={callSheet.importantNote} />
            <SheetText title="Ограничения по актёрам" text={callSheet.actorRestrictions} />
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <Block title="Руководители группы">
              {callSheet.leaders.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-1 text-sm">
                  {callSheet.leaders.map((row) => (
                    <li key={row.id}>
                      <span className="font-medium">{row.shortTitle || row.position}</span>
                      {row.personName ? ` — ${row.personName}` : ""}
                      {row.phone ? (
                        <span className="text-[var(--muted-fg)]"> · {row.phone}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Цеха и вызов">
              {callSheet.crewCalls.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-1 text-sm">
                  {callSheet.crewCalls.map((row) => (
                    <li key={row.id} className="flex justify-between gap-3">
                      <span>{row.label}</span>
                      <span className="tabular-nums text-[var(--muted-fg)]">
                        {row.callTime ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="База и транспорт группы">
              {callSheet.baseItems.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-1 text-sm">
                  {callSheet.baseItems.map((row) => (
                    <li
                      key={row.id}
                      className={
                        row.notNeeded
                          ? "flex justify-between gap-3 text-[var(--muted-fg)] line-through"
                          : "flex justify-between gap-3"
                      }
                    >
                      <span>{row.name}</span>
                      <span className="tabular-nums">
                        {row.notNeeded ? "не нужен" : (row.callTime ?? "—")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
        </>
      )}
    </SheetBlock>
  );
}
