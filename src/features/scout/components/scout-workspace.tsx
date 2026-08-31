"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { ScoutCandidateStatus } from "@prisma/client";
import Link from "next/link";
import {
  createScoutCandidateAction,
  deleteScoutCandidateAction,
  updateScoutCandidateStatusAction,
  type ScoutActionState,
} from "@/features/scout/actions";
import { scoutStatusLabels, scoutStatusOptions } from "@/features/preproduction/lib/status-labels";
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";

const initial: ScoutActionState = {};

type ScoutRow = Awaited<
  ReturnType<typeof import("@/features/scout/queries").listScoutCandidates>
>[number];

type LocationOpt = { id: string; name: string; sublocation: string | null };

export function ScoutWorkspace({
  projectId,
  locale,
  candidates,
  locations,
  canWrite,
}: {
  projectId: string;
  locale: string;
  candidates: ScoutRow[];
  locations: LocationOpt[];
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const bound = createScoutCandidateAction.bind(null, projectId);
  const [state, action, formPending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

  function runStatus(candidateId: string, status: ScoutCandidateStatus) {
    startTransition(async () => {
      const result = await updateScoutCandidateStatusAction(
        projectId,
        candidateId,
        status,
      );
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setOpen(true)}>
            + Кандидат-локация
          </Button>
        ) : null}
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Кандидаты скаута не добавлены.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 px-3">Место</th>
                <th className="py-2 px-3">Игровая локация</th>
                <th className="py-2 px-3">Адрес</th>
                <th className="py-2 px-3">Стоимость</th>
                <th className="py-2 px-3">Статус</th>
                {canWrite ? <th className="py-2 px-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]/60">
                  <td className="py-3 px-3 font-medium">{row.title}</td>
                  <td className="py-3 px-3">
                    <Link
                      href={`/${locale}/projects/${projectId}/locations/${row.location.id}`}
                      className="hover:text-[var(--accent)]"
                    >
                      {row.location.name}
                      {row.location.sublocation ? ` / ${row.location.sublocation}` : ""}
                    </Link>
                  </td>
                  <td className="py-3 px-3">{row.address ?? "—"}</td>
                  <td className="py-3 px-3">{row.cost?.toString() ?? "—"}</td>
                  <td className="py-3 px-3">
                    <span className="rounded-full bg-[var(--glass-badge-bg)] px-2 py-0.5 text-xs">
                      {scoutStatusLabels[row.status]}
                    </span>
                    {canWrite && row.status !== "APPROVED" ? (
                      <select
                        className="glass-input ml-2 rounded-lg px-2 py-1 text-xs"
                        defaultValue={row.status}
                        disabled={pending}
                        onChange={(e) =>
                          runStatus(row.id, e.target.value as ScoutCandidateStatus)
                        }
                      >
                        {scoutStatusOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  {canWrite ? (
                    <td className="py-3 px-3 text-right">
                      <form
                        action={async () => {
                          const r = await deleteScoutCandidateAction(projectId, row.id);
                          if (r.error) toast.error(r.error);
                          if (r.success) toast.success(r.success);
                        }}
                      >
                        <Button type="submit" variant="danger">
                          ×
                        </Button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Новый кандидат скаута"
        footer={
          <div className="flex gap-3">
            <Button type="submit" form="scout-form" disabled={formPending}>
              {formPending ? "…" : "Добавить"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </div>
        }
      >
        <form id="scout-form" action={action} className="space-y-4">
          <div>
            <Label htmlFor="locationId">Игровая локация *</Label>
            <Select id="locationId" name="locationId" required defaultValue="">
              <option value="" disabled>
                Выберите…
              </option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.sublocation ? ` / ${loc.sublocation}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="title">Название места *</Label>
            <Input id="title" name="title" required />
          </div>
          <div>
            <Label htmlFor="address">Адрес</Label>
            <Input id="address" name="address" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="cost">Стоимость</Label>
              <Input id="cost" name="cost" type="number" min={0} />
            </div>
            <div>
              <Label htmlFor="contactPhone">Телефон контакта</Label>
              <Input id="contactPhone" name="contactPhone" />
            </div>
          </div>
          <div>
            <Label htmlFor="contactName">Контактное лицо</Label>
            <Input id="contactName" name="contactName" />
          </div>
          <div>
            <Label htmlFor="photoUrls">Фото (URL, по одному на строку)</Label>
            <textarea
              id="photoUrls"
              name="photoUrls"
              rows={3}
              className="glass-input w-full resize-y px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="notes">Заметки</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              className="glass-input w-full resize-y px-3 py-2 text-sm"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
