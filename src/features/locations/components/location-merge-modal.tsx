"use client";

import { useState, useTransition } from "react";
import {
  getLocationMergeImpactAction,
  mergeLocationsAction,
} from "@/features/locations/actions";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";

export type MergeCandidate = { id: string; label: string };

/**
 * «Объединить с…»: выбранный объект (подобъект) исчезает, все его связи — у того, с кем
 * объединяют. Перед кнопкой — что произойдёт (или почему нельзя), с сервера.
 */
export function LocationMergeModal({
  projectId,
  source,
  candidates,
  onClose,
}: {
  projectId: string;
  source: { id: string; title: string; isSub: boolean } | null;
  candidates: MergeCandidate[];
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [impact, setImpact] = useState<{ lines: string[] } | { error: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [merging, startMerging] = useTransition();

  function choose(id: string) {
    setTargetId(id);
    setImpact(null);
    setError(null);
    if (!id || !source) return;
    startLoading(async () => {
      setImpact(await getLocationMergeImpactAction(projectId, source.id, id));
    });
  }

  function merge() {
    if (!source || !targetId) return;
    setError(null);
    startMerging(async () => {
      const refusal = await mergeLocationsAction(projectId, source.id, targetId);
      if (refusal) setError(refusal);
      else onClose();
    });
  }

  const ready = Boolean(targetId && impact && "lines" in impact);

  return (
    <Modal
      open={Boolean(source)}
      onClose={onClose}
      title={source ? `Объединить «${source.title}»` : "Объединить"}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!ready || loading || merging} onClick={merge}>
            {merging ? "…" : "Объединить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="merge-target">{source?.isSub ? "С подобъектом" : "С объектом"}</Label>
          <Select id="merge-target" value={targetId} onChange={(e) => choose(e.target.value)}>
            <option value="">— выберите —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        {loading ? <p className="text-sm text-[var(--muted-fg)]">Считаю…</p> : null}
        {impact && "lines" in impact ? (
          <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Что произойдёт">
            {impact.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {impact && "error" in impact ? (
          <p className="text-sm text-[var(--danger)]">{impact.error}</p>
        ) : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </div>
    </Modal>
  );
}
