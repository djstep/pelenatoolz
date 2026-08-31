"use client";

import { useActionState, useEffect, useState } from "react";
import {
  ActorRoleType,
  ContractorType,
  Gender,
} from "@prisma/client";
import {
  createActorAction,
  deleteActorAction,
  updateActorAction,
  type ActorActionState,
} from "@/features/actors/actions";
import {
  ActorPayrollBlock,
  seedExtras,
  seedOvertime,
} from "@/features/actors/components/actor-payroll-block";
import {
  actorRoleTypeLabels,
  contractorTypeLabels,
  formatMinutesHhMm,
  genderLabels,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";

const initial: ActorActionState = {};

type ActorRow = {
  id: string;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  gender: Gender | null;
  roleType: ActorRoleType;
  contractorType: ContractorType;
  phone1: string | null;
  phone2: string | null;
  email: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  tags: string | null;
  specialConditions: string | null;
  shiftRate: { toString(): string } | null;
  shiftHoursMin: number | null;
  unpaidOvertimeMin: number | null;
  forceMajeurePct: { toString(): string } | null;
  characterId: string | null;
  character: { name: string } | null;
  overtimeRates: {
    hourNumber: number;
    percentRate: { toString(): string } | null;
    amount: { toString(): string } | null;
    forceMajeurePct: { toString(): string } | null;
  }[];
  extraPayments: {
    paymentDate: Date | null;
    amount: { toString(): string };
    forceMajeurePct: { toString(): string } | null;
    description: string | null;
  }[];
};

type CharacterOption = { id: string; name: string };

function fullName(actor: ActorRow) {
  return [actor.lastName, actor.firstName, actor.middleName]
    .filter(Boolean)
    .join(" ");
}

function formatOvertime(rates: ActorRow["overtimeRates"]) {
  if (rates.length === 0) return "—";
  return rates
    .map((r) => `${r.hourNumber} ч — ${r.amount?.toString() ?? "?"}`)
    .join("; ");
}

function ActorFormFields({
  actor,
  characters,
}: {
  actor?: ActorRow;
  characters: CharacterOption[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted-fg)]">
        Подбор из кастинг-базы — в разработке (MVP: ручной ввод).
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="lastName">Фамилия *</Label>
          <Input
            id="lastName"
            name="lastName"
            required
            defaultValue={actor?.lastName}
          />
        </div>
        <div>
          <Label htmlFor="firstName">Имя</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={actor?.firstName ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="middleName">Отчество</Label>
          <Input
            id="middleName"
            name="middleName"
            defaultValue={actor?.middleName ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Пол</Label>
          <div className="mt-1 flex gap-4">
            {Object.entries(genderLabels).map(([k, v]) => (
              <label key={k} className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="gender"
                  value={k}
                  defaultChecked={actor?.gender === k}
                />
                {v}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="contractorType">Орг. форма</Label>
          <Select
            id="contractorType"
            name="contractorType"
            defaultValue={actor?.contractorType ?? ContractorType.UNKNOWN}
          >
            {Object.entries(contractorTypeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="characterId">Персонаж</Label>
          <Select
            id="characterId"
            name="characterId"
            defaultValue={actor?.characterId ?? ""}
          >
            <option value="">—</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="roleType">Тип роли</Label>
          <Select
            id="roleType"
            name="roleType"
            defaultValue={actor?.roleType ?? ActorRoleType.SUPPORTING}
          >
            {Object.entries(actorRoleTypeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="agentName">Агент</Label>
          <Input
            id="agentName"
            name="agentName"
            placeholder="ФИО или агентство"
            defaultValue={actor?.agentName ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="agentPhone">Телефон агента</Label>
          <Input
            id="agentPhone"
            name="agentPhone"
            defaultValue={actor?.agentPhone ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="agentEmail">Email агента</Label>
          <Input
            id="agentEmail"
            name="agentEmail"
            type="email"
            defaultValue={actor?.agentEmail ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="phone1">Телефон 1</Label>
          <Input id="phone1" name="phone1" defaultValue={actor?.phone1 ?? ""} />
        </div>
        <div>
          <Label htmlFor="phone2">Телефон 2</Label>
          <Input id="phone2" name="phone2" defaultValue={actor?.phone2 ?? ""} />
        </div>
      </div>

      <div>
        <Label htmlFor="tags">Теги</Label>
        <Input id="tags" name="tags" defaultValue={actor?.tags ?? ""} />
      </div>

      <div>
        <Label htmlFor="specialConditions">Особые условия</Label>
        <textarea
          id="specialConditions"
          name="specialConditions"
          rows={3}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          placeholder="Занятость в спектаклях и т.д."
          defaultValue={actor?.specialConditions ?? ""}
        />
      </div>

      <ActorPayrollBlock
        shiftRate={actor?.shiftRate ? Number(actor.shiftRate) : 0}
        forceMajeurePct={
          actor?.forceMajeurePct ? Number(actor.forceMajeurePct) : 0
        }
        shiftHoursMin={actor?.shiftHoursMin}
        unpaidOvertimeMin={actor?.unpaidOvertimeMin}
        overtime={actor ? seedOvertime(actor.overtimeRates) : []}
        extras={actor ? seedExtras(actor.extraPayments) : []}
      />
    </div>
  );
}

const DISCARD_ACTOR_EDITS_MESSAGE =
  "Есть несохранённые изменения. Закрыть без сохранения?";

function ActorEditorModal({
  projectId,
  actor,
  characters,
  open,
  onClose,
}: {
  projectId: string;
  actor?: ActorRow;
  characters: CharacterOption[];
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(actor);
  const bound = isEdit
    ? updateActorAction.bind(null, projectId, actor!.id)
    : createActorAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  const [dirty, setDirty] = useState(false);
  useActionToast(state);

  useEffect(() => {
    if (open) setDirty(false);
  }, [open, actor?.id]);

  const guardedClose = () => {
    if (dirty && !window.confirm(DISCARD_ACTOR_EDITS_MESSAGE)) return;
    setDirty(false);
    onClose();
  };

  useEffect(() => {
    if (state.success) {
      setDirty(false);
      onClose();
    }
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={guardedClose}
      title={isEdit ? "Редактирование актёра" : "Добавление актёра"}
      wide
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="actor-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={guardedClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form
        id="actor-form"
        action={action}
        key={actor?.id ?? "new"}
        onInput={() => setDirty(true)}
        onChange={() => setDirty(true)}
      >
        <ActorFormFields actor={actor} characters={characters} />
      </form>
    </Modal>
  );
}

export function ActorsWorkspace({
  projectId,
  actors,
  characters,
  canWrite,
}: {
  projectId: string;
  actors: ActorRow[];
  characters: CharacterOption[];
  canWrite: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ActorRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setCreating(true)}>
            + Добавить актёра
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={actors.length === 0}
          onClick={() => {
            const header = [
              "ФИО",
              "Персонаж",
              "Тип роли",
              "Телефон",
              "Email",
              "Орг. форма",
              "Ставка смены",
              "Часы смены",
              "Агент",
              "Телефон агента",
              "Email агента",
            ];
            const rows = actors.map((a) => [
              fullName(a),
              a.character?.name ?? "",
              actorRoleTypeLabels[a.roleType],
              a.phone1 ?? "",
              a.email ?? "",
              contractorTypeLabels[a.contractorType],
              a.shiftRate?.toString() ?? "",
              formatMinutesHhMm(a.shiftHoursMin),
              a.agentName ?? "",
              a.agentPhone ?? "",
              a.agentEmail ?? "",
            ]);
            const escape = (v: string) =>
              /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            const csv = [header, ...rows]
              .map((r) => r.map((c) => escape(String(c))).join(";"))
              .join("\n");
            const blob = new Blob(["\uFEFF" + csv], {
              type: "text/csv;charset=utf-8",
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `actors-${projectId.slice(0, 8)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Экспорт
        </Button>
      </div>

      {actors.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Актёры не добавлены.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 px-3">ФИО</th>
                <th className="py-2 px-3">Персонаж</th>
                <th className="py-2 px-3">Тип роли</th>
                <th className="py-2 px-3">Телефон 1</th>
                <th className="py-2 px-3">Орг. форма</th>
                <th className="py-2 px-3">Смена</th>
                <th className="py-2 px-3">Переработка</th>
                <th className="py-2 px-3">Неоплач. время</th>
                {canWrite ? <th className="py-2 px-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {actors.map((actor) => (
                <tr key={actor.id} className="border-b border-[var(--border)]/60">
                  <td className="py-3 px-3 font-medium">{fullName(actor)}</td>
                  <td className="py-3 px-3">{actor.character?.name ?? "—"}</td>
                  <td className="py-3 px-3">
                    {actorRoleTypeLabels[actor.roleType]}
                  </td>
                  <td className="py-3 px-3">{actor.phone1 ?? "—"}</td>
                  <td className="py-3 px-3">
                    {contractorTypeLabels[actor.contractorType]}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {actor.shiftRate?.toString() ?? "—"}
                    {actor.shiftHoursMin != null
                      ? ` / ${formatMinutesHhMm(actor.shiftHoursMin)}`
                      : ""}
                  </td>
                  <td className="py-3 px-3 text-xs">
                    {formatOvertime(actor.overtimeRates)}
                  </td>
                  <td className="py-3 px-3">
                    {actor.unpaidOvertimeMin != null
                      ? formatMinutesHhMm(actor.unpaidOvertimeMin)
                      : "—"}
                  </td>
                  {canWrite ? (
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditing(actor)}
                        >
                          Изменить
                        </Button>
                        <form
                          action={async () => {
                            await deleteActorAction(projectId, actor.id);
                          }}
                        >
                          <Button type="submit" variant="danger">
                            ×
                          </Button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ActorEditorModal
        projectId={projectId}
        characters={characters}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <ActorEditorModal
        projectId={projectId}
        actor={editing ?? undefined}
        characters={characters}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
