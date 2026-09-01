"use client";

import { useEffect, useState, useTransition } from "react";
import {
  applyRecalculateActorTimingsAction,
  applyRecalculateResourceTimingsAction,
  previewRecalculateActorTimingsAction,
  previewRecalculateResourceTimingsAction,
  type CallSheetActionState,
} from "@/features/day-docs/actions";
import type { ActorTimingProposal } from "@/features/day-docs/lib/compute-call-timings";
import type { ResourceTimingProposal } from "@/features/day-docs/lib/compute-call-timings";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";
import { useActionToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

const actorFieldLabels: Record<string, string> = {
  pickupTime: "Подача",
  makeupTime: "Грим",
  costumeTime: "Костюм",
  readyTime: "Готовность",
  wrapTime: "Конец",
};

const resourceFieldLabels: Record<string, string> = {
  arrivalTime: "Прибытие",
  makeupTime: "Грим",
  costumeTime: "Костюм",
  readyTime: "Готовность",
  wrapTime: "Конец",
};

function ProposalTable({
  fields,
  labels,
}: {
  fields: Record<string, { current: string | null; proposed: string | null } | undefined>;
  labels: Record<string, string>;
}) {
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead>
        <tr className="text-[var(--muted-fg)]">
          <th className="py-1 pr-2">Поле</th>
          <th className="py-1 pr-2">Было</th>
          <th className="py-1">Станет</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(fields).map(([field, change]) => (
          <tr key={field} className="border-t border-[var(--border)]/40">
            <td className="py-1 pr-2">{labels[field] ?? field}</td>
            <td className="py-1 pr-2 font-mono text-[var(--muted-fg)]">
              {change?.current || "—"}
            </td>
            <td className="py-1 font-mono text-emerald-300">
              {change?.proposed || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CallSheetRecalculateModal({
  open,
  onClose,
  projectId,
  dayId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  dayId: string;
}) {
  const [tab, setTab] = useState<"actors" | "resources">("actors");
  const [actorProposals, setActorProposals] = useState<ActorTimingProposal[]>([]);
  const [resourceProposals, setResourceProposals] = useState<ResourceTimingProposal[]>(
    [],
  );
  const [selectedActors, setSelectedActors] = useState<Set<string>>(new Set());
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<CallSheetActionState>({});
  const [pending, startTransition] = useTransition();

  useActionToast(message);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    setTab("actors");
    void Promise.all([
      previewRecalculateActorTimingsAction(projectId, dayId),
      previewRecalculateResourceTimingsAction(projectId, dayId),
    ]).then(([actorsResult, resourcesResult]) => {
      if ("error" in actorsResult) {
        setLoadError(actorsResult.error);
        setActorProposals([]);
        setSelectedActors(new Set());
      } else {
        setActorProposals(actorsResult.proposals);
        setSelectedActors(new Set(actorsResult.proposals.map((p) => p.actorId)));
      }

      if ("error" in resourcesResult) {
        if ("error" in actorsResult) setLoadError(resourcesResult.error);
        setResourceProposals([]);
        setSelectedResources(new Set());
      } else {
        setResourceProposals(resourcesResult.proposals);
        setSelectedResources(new Set(resourcesResult.proposals.map((p) => p.key)));
        if (
          !("error" in actorsResult) &&
          actorsResult.proposals.length === 0 &&
          resourcesResult.proposals.length > 0
        ) {
          setTab("resources");
        }
      }
    });
  }, [open, projectId, dayId]);

  const selectedCount =
    tab === "actors" ? selectedActors.size : selectedResources.size;

  function apply() {
    startTransition(async () => {
      const result =
        tab === "actors"
          ? await applyRecalculateActorTimingsAction(
              projectId,
              dayId,
              Array.from(selectedActors),
            )
          : await applyRecalculateResourceTimingsAction(
              projectId,
              dayId,
              Array.from(selectedResources),
            );
      setMessage(result);
      if (!result.error) onClose();
    });
  }

  const proposals = tab === "actors" ? actorProposals : resourceProposals;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Пересчитать тайминги"
      wide
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending || selectedCount === 0}
            onClick={apply}
          >
            {pending ? "Применение…" : `Применить (${selectedCount})`}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex gap-2 border-b border-[var(--border)] pb-3">
        <button
          type="button"
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm",
            tab === "actors"
              ? "bg-[var(--accent)]/20 text-[var(--foreground)]"
              : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
          )}
          onClick={() => setTab("actors")}
        >
          Актёры ({actorProposals.length})
        </button>
        <button
          type="button"
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm",
            tab === "resources"
              ? "bg-[var(--accent)]/20 text-[var(--foreground)]"
              : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
          )}
          onClick={() => setTab("resources")}
        >
          Ресурсы ({resourceProposals.length})
        </button>
      </div>

      {loadError ? (
        <p className="text-sm text-[var(--danger)]">{loadError}</p>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          {tab === "actors"
            ? "Нет предлагаемых изменений для актёров. Проверьте расписание дня и смещения в карточках персонажей."
            : "Нет предлагаемых изменений для ресурсов. Проверьте план дня и привязку ресурсов к сценам."}
        </p>
      ) : (
        <div className="max-h-[min(28rem,60vh)] space-y-3 overflow-y-auto">
          {tab === "actors"
            ? actorProposals.map((proposal) => (
                <div
                  key={proposal.actorId}
                  className="rounded-xl border border-[var(--border)] bg-black/15 p-3"
                >
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selectedActors.has(proposal.actorId)}
                      onChange={(e) => {
                        setSelectedActors((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(proposal.actorId);
                          else next.delete(proposal.actorId);
                          return next;
                        });
                      }}
                    />
                    {proposal.label}
                  </label>
                  <ProposalTable fields={proposal.fields} labels={actorFieldLabels} />
                </div>
              ))
            : resourceProposals.map((proposal) => (
                <div
                  key={proposal.key}
                  className="rounded-xl border border-[var(--border)] bg-black/15 p-3"
                >
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selectedResources.has(proposal.key)}
                      onChange={(e) => {
                        setSelectedResources((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(proposal.key);
                          else next.delete(proposal.key);
                          return next;
                        });
                      }}
                    />
                    {proposal.label}
                  </label>
                  <ProposalTable fields={proposal.fields} labels={resourceFieldLabels} />
                </div>
              ))}
        </div>
      )}
    </Modal>
  );
}
