"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { CastingCandidateStatus } from "@prisma/client";
import Link from "next/link";
import {
  addCastingApplicationAction,
  createCastingPersonAction,
  deleteCastingPersonAction,
  updateCastingCandidateStatusAction,
  updateCastingPersonAction,
  type CastingActionState,
} from "@/features/casting/actions";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { PersonFormFields } from "@/features/casting/components/casting-person-form-fields";
import {
  castingStatusOptions,
} from "@/features/preproduction/lib/status-labels";
import { StatusSelect } from "@/features/preproduction/components/status-select";
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";

const initial: CastingActionState = {};

type PersonRow = Awaited<
  ReturnType<typeof import("@/features/casting/queries").listCastingPeople>
>[number];

type CharacterOpt = { id: string; name: string };

function PersonModal({
  projectId,
  person,
  characters,
  open,
  onClose,
}: {
  projectId: string;
  person?: PersonRow;
  characters: CharacterOpt[];
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(person);
  const bound = isEdit
    ? updateCastingPersonAction.bind(null, projectId, person!.id)
    : createCastingPersonAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование кандидата" : "Новый кандидат"}
      wide
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="casting-person-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="casting-person-form" action={action} key={person?.id ?? "new"}>
        <PersonFormFields
          projectId={projectId}
          person={person}
          characters={characters}
          showCharacterPicker={!isEdit}
        />
      </form>
    </Modal>
  );
}

export function CastingWorkspace({
  projectId,
  locale,
  people,
  characters,
  canWrite,
  statusFilter,
}: {
  projectId: string;
  locale: string;
  people: PersonRow[];
  characters: CharacterOpt[];
  canWrite: boolean;
  statusFilter?: CastingCandidateStatus | "ALL";
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const filtered = people.filter((person) => {
    if (!statusFilter || statusFilter === "ALL") return true;
    return person.candidates.some((c) => c.status === statusFilter);
  });

  function runStatus(candidateId: string, status: CastingCandidateStatus) {
    startTransition(async () => {
      const result = await updateCastingCandidateStatusAction(
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
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setCreating(true)}>
            + Кандидат
          </Button>
        ) : null}
        <span className="text-sm text-[var(--muted-fg)]">
          {filtered.length} человек в воронке
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Кандидаты не добавлены. Создайте человека и привяжите к персонажу.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 px-3">Кандидат</th>
                <th className="py-2 px-3">Контакты</th>
                <th className="py-2 px-3">Роли</th>
                <th className="py-2 px-3">Ставка</th>
                {canWrite ? <th className="py-2 px-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((person) => (
                <tr key={person.id} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-3 px-3 font-medium">
                    <Link
                      href={`/${locale}/projects/${projectId}/preproduction/casting/${person.id}`}
                      className="hover:text-[var(--accent)]"
                    >
                      {fullNameFromParts(person)}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-[var(--muted-fg)]">
                    {person.phone ?? "—"}
                    {person.agentName ? (
                      <div className="text-xs">Агент: {person.agentName}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-3">
                    <ul className="space-y-1 text-xs">
                      {person.candidates.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/${locale}/projects/${projectId}/characters/${c.character.id}`}
                            className="font-medium hover:text-[var(--accent)]"
                          >
                            {c.character.name}
                          </Link>
                          <StatusSelect
                            value={c.status}
                            options={castingStatusOptions}
                            disabled={!canWrite || pending}
                            onChange={
                              canWrite
                                ? (next) =>
                                    runStatus(c.id, next as CastingCandidateStatus)
                                : undefined
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {person.proposedRate?.toString() ?? "—"}
                  </td>
                  {canWrite ? (
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditing(person)}
                      >
                        Изменить
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PersonModal
        projectId={projectId}
        characters={characters}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <PersonModal
        projectId={projectId}
        person={editing ?? undefined}
        characters={characters}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
