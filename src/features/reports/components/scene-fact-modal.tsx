"use client";

import { ProductionSceneFactStatus } from "@prisma/client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductionSceneFactAction } from "@/features/reports/actions";
import {
  productionSceneFactStatusLabels,
} from "@/features/reports/schemas";
import type { ProductionReportBundle } from "@/features/reports/types";
import {
  formatSecondsMmSs,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

type SceneFact = ProductionReportBundle["report"]["sceneFacts"][number];

type MontageRowState = {
  scenePart: string;
  frame: string;
  take: string;
  takeStatus: string;
  takeRuntime: string;
  cameraFiles: string[];
  shotSize: string;
};

function emptyMontageRow(cameraCount: number): MontageRowState {
  return {
    scenePart: "",
    frame: "",
    take: "",
    takeStatus: "",
    takeRuntime: "",
    cameraFiles: Array.from({ length: cameraCount }, () => ""),
    shotSize: "",
  };
}

function parseCameraFiles(raw: unknown, cameraCount: number): string[] {
  const arr = Array.isArray(raw) ? raw.map((v) => String(v ?? "")) : [];
  const out = Array.from({ length: cameraCount }, (_, i) => arr[i] ?? "");
  return out;
}

export function SceneFactModal({
  open,
  onClose,
  projectId,
  dayId,
  fact,
  cameraCount,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  dayId: string;
  fact: SceneFact | null;
  cameraCount: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [status, setStatus] = useState<ProductionSceneFactStatus>("NOT_SHOT");
  const [factChrono, setFactChrono] = useState("");
  const [prepStart, setPrepStart] = useState("");
  const [prepEnd, setPrepEnd] = useState("");
  const [rehearsalStart, setRehearsalStart] = useState("");
  const [rehearsalEnd, setRehearsalEnd] = useState("");
  const [motorStart, setMotorStart] = useState("");
  const [motorEnd, setMotorEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [montageRows, setMontageRows] = useState<MontageRowState[]>([]);

  useEffect(() => {
    if (!fact || !open) return;
    setStatus(fact.status);
    setFactChrono(
      fact.factSeconds != null && fact.factSeconds > 0
        ? formatSecondsMmSs(fact.factSeconds)
        : "",
    );
    setPrepStart(fact.prepStart ?? "");
    setPrepEnd(fact.prepEnd ?? "");
    setRehearsalStart(fact.rehearsalStart ?? "");
    setRehearsalEnd(fact.rehearsalEnd ?? "");
    setMotorStart(fact.motorStart ?? "");
    setMotorEnd(fact.motorEnd ?? "");
    setNotes(fact.notes ?? "");
    setMontageRows(
      fact.montageRows.length > 0
        ? fact.montageRows.map((row) => ({
            scenePart: row.scenePart ?? "",
            frame: row.frame ?? "",
            take: row.take ?? "",
            takeStatus: row.takeStatus ?? "",
            takeRuntime: row.takeRuntime ?? "",
            cameraFiles: parseCameraFiles(row.cameraFiles, cameraCount),
            shotSize: row.shotSize ?? "",
          }))
        : [],
    );
  }, [fact, open, cameraCount]);

  const title = useMemo(() => {
    if (!fact) return "Факт по сцене";
    return `Факт · ${fact.sceneLabel || fact.scene.number}`;
  }, [fact]);

  if (!fact) return null;

  const returnsToPool =
    status === "NOT_SHOT" ||
    status === "RESHOOT_REQUIRED" ||
    status === "DELETED";

  const save = () => {
    startTransition(async () => {
      const result = await saveProductionSceneFactAction(projectId, dayId, {
        sceneId: fact.sceneId,
        status,
        factSeconds: factChrono,
        prepStart,
        prepEnd,
        rehearsalStart,
        rehearsalEnd,
        motorStart,
        motorEnd,
        notes,
        montageRows,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Сохранено");
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            {canEdit ? "Отмена" : "Закрыть"}
          </Button>
          {returnsToPool && canEdit ? (
            <p className="ml-auto max-w-md text-xs text-amber-200/90">
              При статусе «{productionSceneFactStatusLabels[status]}» сцена
              вернётся в неспланированные КПП, но останется в этом отчёте.
            </p>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Статус</Label>
            <select
              className="glass-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
              value={status}
              disabled={!canEdit}
              onChange={(e) =>
                setStatus(e.target.value as ProductionSceneFactStatus)
              }
            >
              {(Object.keys(productionSceneFactStatusLabels) as ProductionSceneFactStatus[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {productionSceneFactStatusLabels[key]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <Label>Фактический хронометраж (мм:сс)</Label>
            <Input
              className="mt-1"
              value={factChrono}
              disabled={!canEdit}
              placeholder="00:00"
              onChange={(e) => setFactChrono(e.target.value)}
            />
            {fact.scene.planSeconds ? (
              <p className="mt-1 text-[10px] text-[var(--muted-fg)]">
                План: {formatSecondsMmSs(fact.scene.planSeconds)}
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Время по этапам</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["prepStart", "Подготовка · начало", prepStart, setPrepStart],
                ["prepEnd", "Подготовка · конец", prepEnd, setPrepEnd],
                [
                  "rehearsalStart",
                  "Репетиция · начало",
                  rehearsalStart,
                  setRehearsalStart,
                ],
                [
                  "rehearsalEnd",
                  "Репетиция · конец",
                  rehearsalEnd,
                  setRehearsalEnd,
                ],
                ["motorStart", "Мотор · начало", motorStart, setMotorStart],
                ["motorEnd", "Мотор · конец", motorEnd, setMotorEnd],
              ] as const
            ).map(([key, label, value, setter]) => (
              <label key={key} className="space-y-1 text-xs">
                <span className="text-[var(--muted-fg)]">{label}</span>
                <HhMmInput
                  value={value}
                  disabled={!canEdit}
                  onChange={setter}
                  placeholder="00:00"
                />
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Монтажная карточка</h4>
              <p className="text-xs text-[var(--muted-fg)]">
                Справочная таблица · {cameraCount}{" "}
                {cameraCount === 1 ? "камера" : "камер"} (из настроек проекта)
              </p>
            </div>
            {canEdit ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setMontageRows((prev) => [
                    ...prev,
                    emptyMontageRow(cameraCount),
                  ])
                }
              >
                + Добавить
              </Button>
            ) : null}
          </div>

          {montageRows.length === 0 ? (
            <p className="text-sm text-[var(--muted-fg)]">Строк пока нет.</p>
          ) : (
            <div className="space-y-3">
              {montageRows.map((row, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[var(--border)] p-3"
                >
                  <div className="mb-2 flex justify-between">
                    <span className="text-xs text-[var(--muted-fg)]">
                      Строка {i + 1}
                    </span>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-[var(--danger)]"
                        onClick={() =>
                          setMontageRows((prev) =>
                            prev.filter((_, idx) => idx !== i),
                          )
                        }
                      >
                        Удалить
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      [
                        ["scenePart", "Часть сцены", row.scenePart],
                        ["frame", "Кадр", row.frame],
                        ["take", "Дубль", row.take],
                        ["takeStatus", "Статус дубля", row.takeStatus],
                        ["takeRuntime", "Хрон. дубля", row.takeRuntime],
                        ["shotSize", "Крупность плана", row.shotSize],
                      ] as const
                    ).map(([field, label, value]) => (
                      <label key={field} className="space-y-1 text-xs">
                        <span className="text-[var(--muted-fg)]">{label}</span>
                        <Input
                          value={value}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMontageRows((prev) =>
                              prev.map((r, idx) =>
                                idx === i ? { ...r, [field]: v } : r,
                              ),
                            );
                          }}
                        />
                      </label>
                    ))}
                    {row.cameraFiles.map((file, camIdx) => (
                      <label
                        key={`cam-${camIdx}`}
                        className="space-y-1 text-xs"
                      >
                        <span className="text-[var(--muted-fg)]">
                          № файла кам. {camIdx + 1}
                        </span>
                        <Input
                          value={file}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMontageRows((prev) =>
                              prev.map((r, idx) => {
                                if (idx !== i) return r;
                                const cameraFiles = [...r.cameraFiles];
                                cameraFiles[camIdx] = v;
                                return { ...r, cameraFiles };
                              }),
                            );
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="scene-fact-notes">Примечание</Label>
          <textarea
            id="scene-fact-notes"
            rows={3}
            className="glass-input mt-1 w-full resize-y px-3 py-2 text-sm"
            value={notes}
            disabled={!canEdit}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
