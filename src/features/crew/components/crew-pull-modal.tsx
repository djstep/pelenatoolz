"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { counterpartyTypeLabels } from "@/features/counterparties/labels";
import {
  getCrewPullCandidatesAction,
  pullCrewFromContractsAction,
} from "@/features/crew/contract-actions";
import {
  NO_DEPARTMENT_TITLE,
  type CrewDepartment,
  type CrewRights,
} from "@/features/crew/lib/crew-rules";
import type { CrewMatch, CrewPullCandidate } from "@/features/crew/lib/crew-sync";
import { formatDateShort } from "@/shared/i18n/format-date";
import { statusBadgeStyle } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";

const ADD_SEPARATELY = "new";

type Draft = {
  selected: boolean;
  /** С кем связать; `null` — новый человек. */
  memberId: string | null;
  lastName: string;
  firstName: string;
  middleName: string;
  position: string;
  departmentId: string;
  phone: string;
  email: string;
};

function initialDraft(candidate: CrewPullCandidate): Draft {
  return {
    selected: false,
    // Похожий человек есть — по умолчанию связать, дубль создаётся только осознанно.
    memberId: candidate.inTeam?.id ?? candidate.similar[0]?.id ?? null,
    lastName: candidate.lastName,
    firstName: candidate.firstName ?? "",
    middleName: candidate.middleName ?? "",
    position: "",
    departmentId: candidate.departmentId ?? "",
    phone: candidate.phone ?? "",
    email: candidate.email ?? "",
  };
}

function matchName(match: CrewMatch) {
  return match.archived ? `${match.name} (в архиве)` : match.name;
}

function resultMessage(created: number, linked: number, skipped: number) {
  const parts = [
    created > 0 ? `добавлено: ${created}` : "",
    linked > 0 ? `связано с существующими: ${linked}` : "",
    skipped > 0 ? `уже были в команде: ${skipped}` : "",
  ].filter(Boolean);
  const text = parts.join(", ");
  return text ? text[0].toLocaleUpperCase("ru") + text.slice(1) : "Ничего не изменилось";
}

function CandidateCard({
  candidate,
  draft,
  departments,
  rights,
  onChange,
}: {
  candidate: CrewPullCandidate;
  draft: Draft;
  departments: CrewDepartment[];
  rights: CrewRights;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const id = candidate.counterpartyId;
  const creating = draft.memberId === null;
  /** Правка поля — значит, строку берут: галочка ставится сама. */
  const edit = (patch: Partial<Draft>) => onChange({ ...patch, selected: true });

  return (
    <section
      data-testid="crew-pull-row"
      data-counterparty={candidate.counterpartyName}
      className="space-y-3 rounded-xl border border-[var(--border)] p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Checkbox
          checked={draft.selected}
          aria-label={`Выбрать: ${candidate.counterpartyName}`}
          onChange={(e) => onChange({ selected: e.target.checked })}
        >
          <span className="font-semibold">{candidate.counterpartyName}</span>
        </Checkbox>
        <span className="text-xs text-[var(--muted-fg)]">
          {counterpartyTypeLabels[candidate.counterpartyType]}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {candidate.contracts.map((contract) => (
            <span key={contract.id} className="inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--muted-fg)]">
                № {contract.number} от {formatDateShort(contract.date)}
              </span>
              <span className="status-badge" style={statusBadgeStyle(contract.statusColor)}>
                {contract.statusName}
              </span>
            </span>
          ))}
        </div>
      </div>

      {candidate.inTeam ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Уже в команде: {matchName(candidate.inTeam)}. Договор будет связан с этим человеком.
        </p>
      ) : null}

      {candidate.similar.length > 0 ? (
        <div className="max-w-md">
          <Label htmlFor={`${id}-match`}>
            Возможно, уже есть: {candidate.similar.map(matchName).join(", ")}
          </Label>
          <Select
            id={`${id}-match`}
            value={draft.memberId ?? ADD_SEPARATELY}
            onChange={(e) =>
              edit({ memberId: e.target.value === ADD_SEPARATELY ? null : e.target.value })
            }
          >
            {candidate.similar.map((match) => (
              <option key={match.id} value={match.id}>
                Связать с: {matchName(match)}
              </option>
            ))}
            <option value={ADD_SEPARATELY}>Добавить отдельно</option>
          </Select>
        </div>
      ) : null}

      {creating ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor={`${id}-lastName`}>Фамилия *</Label>
            <Input
              id={`${id}-lastName`}
              value={draft.lastName}
              onChange={(e) => edit({ lastName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-firstName`}>Имя</Label>
            <Input
              id={`${id}-firstName`}
              value={draft.firstName}
              onChange={(e) => edit({ firstName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-middleName`}>Отчество</Label>
            <Input
              id={`${id}-middleName`}
              value={draft.middleName}
              onChange={(e) => edit({ middleName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-position`}>Должность</Label>
            <Input
              id={`${id}-position`}
              value={draft.position}
              onChange={(e) => edit({ position: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-department`}>Цех</Label>
            <Select
              id={`${id}-department`}
              value={draft.departmentId}
              onChange={(e) => edit({ departmentId: e.target.value })}
            >
              <option value="">{NO_DEPARTMENT_TITLE}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          {rights.contacts ? (
            <>
              <div>
                <Label htmlFor={`${id}-phone`}>Телефон</Label>
                <Input
                  id={`${id}-phone`}
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => edit({ phone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${id}-email`}>Почта</Label>
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={draft.email}
                  onChange={(e) => edit({ email: e.target.value })}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Окно «Подтянуть из договоров». Открывается каждый раз заново: данные читаются при открытии. */
export function CrewPullModal({
  projectId,
  departments,
  rights,
  onClose,
}: {
  projectId: string;
  departments: CrewDepartment[];
  rights: CrewRights;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<CrewPullCandidate[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void getCrewPullCandidatesAction(projectId).then((result) => {
      if (!active) return;
      if (result.error) toast.error(result.error);
      const list = result.candidates ?? [];
      setDrafts(Object.fromEntries(list.map((c) => [c.counterpartyId, initialDraft(c)])));
      setCandidates(list);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const chosen = (candidates ?? []).filter((c) => drafts[c.counterpartyId]?.selected);

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen.length === 0) return;
    const items = chosen.map(({ counterpartyId }) => {
      const draft = drafts[counterpartyId];
      if (draft.memberId) {
        return { mode: "link" as const, counterpartyId, memberId: draft.memberId };
      }
      const { lastName, firstName, middleName, position, departmentId, phone, email } = draft;
      return {
        mode: "create" as const,
        counterpartyId,
        person: {
          lastName,
          firstName,
          middleName,
          position,
          departmentId,
          // Без права поля пустые и не отправляются; сервер их всё равно не запишет.
          ...(rights.contacts ? { phone, email } : {}),
        },
      };
    });
    startTransition(async () => {
      const result = await pullCrewFromContractsAction(projectId, items);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(resultMessage(result.created ?? 0, result.linked ?? 0, result.skipped ?? 0));
      onClose();
    });
  }

  return (
    <Modal
      guardUnsaved
      baselineKey={candidates?.length ?? -1}
      open
      onClose={onClose}
      title="Подтянуть из договоров"
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            form="crew-pull-form"
            disabled={pending || chosen.length === 0}
          >
            {pending ? "…" : `Добавить выбранных${chosen.length ? `: ${chosen.length}` : ""}`}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="crew-pull-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-[var(--muted-fg)]">
          Физлица, самозанятые и ИП, которых ещё нет в команде. Проверьте данные: они разобраны из
          контрагента. Должность и цех можно указать здесь.
          {rights.contacts ? null : " Телефон и почта не подтягиваются: нет права «Команда: контакты»."}
        </p>
        {candidates === null ? <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p> : null}
        {candidates?.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Новых договоров нет.</p>
        ) : null}
        {candidates?.map((candidate) => (
          <CandidateCard
            key={candidate.counterpartyId}
            candidate={candidate}
            draft={drafts[candidate.counterpartyId]}
            departments={departments}
            rights={rights}
            onChange={(patch) => patchDraft(candidate.counterpartyId, patch)}
          />
        ))}
      </form>
    </Modal>
  );
}
