"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { counterpartyTypeLabels } from "@/features/counterparties/labels";
import {
  getCrewLinkOptionsAction,
  linkCrewMemberContractAction,
} from "@/features/crew/contract-actions";
import type { CrewLinkOption } from "@/features/crew/contract-queries";
import { formatDateShort } from "@/shared/i18n/format-date";
import { statusBadgeStyle } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Modal } from "@/shared/ui/modal";
import { toast } from "@/shared/ui/toast";

function matches(option: CrewLinkOption, query: string) {
  const q = query.trim().toLocaleLowerCase("ru");
  return (
    !q ||
    option.number.toLocaleLowerCase("ru").includes(q) ||
    option.counterpartyName.toLocaleLowerCase("ru").includes(q)
  );
}

/** Окно «Связать с договором»: отклонённых договоров и занятых контрагентов в списке нет. */
export function CrewLinkModal({
  projectId,
  memberId,
  memberName,
  onClose,
}: {
  projectId: string;
  memberId: string;
  memberName: string;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<CrewLinkOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void getCrewLinkOptionsAction(projectId, memberId).then((result) => {
      if (!active) return;
      if (result.error) toast.error(result.error);
      setOptions(result.options ?? []);
    });
    return () => {
      active = false;
    };
  }, [projectId, memberId]);

  const visible = useMemo(
    () => (options ?? []).filter((option) => matches(option, query)),
    [options, query],
  );

  function link(contractId: string) {
    startTransition(async () => {
      const result = await linkCrewMemberContractAction(projectId, memberId, contractId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Договор связан");
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title={`Связать с договором: ${memberName}`} wide>
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-fg)]">
          Данные человека не изменятся: разницу покажет «Обновить из договора». Из договора с ООО
          берутся только телефон и почта.
        </p>
        <Input
          type="search"
          aria-label="Поиск договора"
          placeholder="Номер, контрагент"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {options === null ? <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p> : null}
        {options !== null && visible.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Подходящих договоров нет.</p>
        ) : null}
        <ul className="divide-y divide-[var(--border)]">
          {visible.map((option) => (
            <li
              key={option.id}
              data-testid="crew-link-option"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="font-medium">№ {option.number}</span>
              <span className="text-[var(--muted-fg)]">от {formatDateShort(option.date)}</span>
              <span>{option.counterpartyName}</span>
              <span className="text-xs text-[var(--muted-fg)]">
                {counterpartyTypeLabels[option.counterpartyType]}
              </span>
              <span className="status-badge" style={statusBadgeStyle(option.statusColor)}>
                {option.statusName}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="ml-auto"
                disabled={pending}
                onClick={() => link(option.id)}
              >
                Связать
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
