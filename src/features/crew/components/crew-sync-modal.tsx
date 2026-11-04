"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
  applyCrewSyncAction,
  getCrewSyncPreviewAction,
  type CrewSyncPreview,
} from "@/features/crew/contract-actions";
import type { CrewRights } from "@/features/crew/lib/crew-rules";
import type { CrewSyncField, CrewSyncRow } from "@/features/crew/lib/crew-sync";
import { formatDateShort } from "@/shared/i18n/format-date";
import { statusBadgeStyle } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";

function changeNote(row: CrewSyncRow) {
  if (row.changedInContract && row.changedManually) return "изменено и там, и там";
  return row.changedInContract ? "изменилось в договоре" : "изменено вручную";
}

/** «Обновить из договора»: что изменилось относительно снимка, применяется по галочкам. */
export function CrewSyncModal({
  projectId,
  memberId,
  memberName,
  rights,
  onClose,
  onApplied,
}: {
  projectId: string;
  memberId: string;
  memberName: string;
  rights: CrewRights;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [contractId, setContractId] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<CrewSyncPreview | null>(null);
  const [checked, setChecked] = useState<Set<CrewSyncField>>(new Set());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void getCrewSyncPreviewAction(projectId, memberId, contractId).then((result) => {
      if (!active) return;
      if (result.error) toast.error(result.error);
      setPreview(result);
      setChecked(new Set(result.rows?.filter((r) => r.checked).map((r) => r.field)));
    });
    return () => {
      active = false;
    };
  }, [projectId, memberId, contractId]);

  const rows = preview?.rows ?? [];
  const contracts = preview?.contracts ?? [];
  const contract = contracts.find((c) => c.id === preview?.contractId);

  function toggle(field: CrewSyncField, on: boolean) {
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!contract || checked.size === 0) return;
    startTransition(async () => {
      const result = await applyCrewSyncAction(projectId, memberId, contract.id, [...checked]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Обновлено из договора");
      onApplied();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Обновить из договора: ${memberName}`}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            form="crew-sync-form"
            disabled={pending || !contract || checked.size === 0}
          >
            {pending ? "…" : "Применить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="crew-sync-form" onSubmit={submit} className="space-y-3">
        {preview === null ? <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p> : null}

        {contracts.length > 1 ? (
          <div className="max-w-md">
            <Label htmlFor="crew-sync-contract">Договор</Label>
            <Select
              id="crew-sync-contract"
              value={preview?.contractId ?? ""}
              onChange={(e) => setContractId(e.target.value)}
            >
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  № {c.number}, {c.counterpartyName}, {c.statusName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {contract ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              № {contract.number} от {formatDateShort(contract.date)}, {contract.counterpartyName}
            </span>
            <span className="status-badge" style={statusBadgeStyle(contract.statusColor)}>
              {contract.statusName}
            </span>
          </p>
        ) : null}

        {contract?.legalEntity ? (
          <p className="text-sm text-[var(--muted-fg)]">
            Договор с ООО: берутся только телефон и почта.
          </p>
        ) : null}
        {rights.contacts ? null : (
          <p className="text-sm text-[var(--muted-fg)]">
            Телефон и почта не показываются: нет права «Команда: контакты».
          </p>
        )}
        {preview?.neverSynced ? (
          <p className="text-sm text-[var(--muted-fg)]">
            Из договора ещё ничего не брали: заполненные вручную поля не отмечены.
          </p>
        ) : null}

        {contract && rows.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Отличий от договора нет.</p>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="glass-table w-full border-collapse text-left text-sm sm:min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="w-8 px-2 py-2" aria-label="Применить" />
                  <th className="px-3 py-2">Поле</th>
                  {/* На телефоне важнее «Сейчас» и «В договоре»: иначе разница уезжает за край окна. */}
                  <th className="hidden px-3 py-2 sm:table-cell">Было при обновлении</th>
                  <th className="px-3 py-2">Сейчас</th>
                  <th className="px-3 py-2">В договоре</th>
                  <th className="px-3 py-2">Что изменилось</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.field}
                    data-sync-field={row.field}
                    className="border-b border-[var(--border)]/60 align-top"
                  >
                    <td className="px-2 py-2">
                      <Checkbox
                        checked={checked.has(row.field)}
                        aria-label={`Применить: ${row.label}`}
                        onChange={(e) => toggle(row.field, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="hidden px-3 py-2 text-[var(--muted-fg)] sm:table-cell">{row.snapshot || "—"}</td>
                    <td className="px-3 py-2">{row.current || "—"}</td>
                    <td className="px-3 py-2">{row.contract || "пусто"}</td>
                    <td className="px-3 py-2 text-[var(--muted-fg)]">{changeNote(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
