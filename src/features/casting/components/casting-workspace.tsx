"use client";

import { useMemo, useState, useTransition } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import type { CastingCandidateStatus } from "@prisma/client";
import Link from "next/link";
import {
  createCastingPersonAction,
  deleteCastingPersonAction,
  getCastingPersonDeleteImpactAction,
  updateCastingCandidateStatusAction,
  updateCastingPersonAction,
  type CastingActionState,
} from "@/features/casting/actions";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { PersonFormFields } from "@/features/casting/components/casting-person-form-fields";
import { CastingCastListExport } from "@/features/casting/components/casting-cast-list-export";
import {
  CASTING_FILTER_NO_CHARACTER,
  countCastingPeople,
  groupCastingPeople,
  resolveCastingFilter,
} from "@/features/casting/lib/casting-groups";
import {
  castingStatusOptions,
} from "@/features/preproduction/lib/status-labels";
import { StatusSelect } from "@/features/preproduction/components/status-select";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import type { FinanceAccess } from "@/shared/lib/finance-fields";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";

const initial: CastingActionState = {};

type PersonRow = Awaited<
  ReturnType<typeof import("@/features/casting/queries").listCastingPeople>
>[number];

type CharacterOpt = { id: string; name: string };

function PersonModal({
  projectId,
  person,
  characters,
  finance,
  open,
  onClose,
}: {
  projectId: string;
  person?: PersonRow;
  characters: CharacterOpt[];
  finance: FinanceAccess;
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(person);
  const bound = isEdit
    ? updateCastingPersonAction.bind(null, projectId, person!.id)
    : createCastingPersonAction.bind(null, projectId);
  const [state, action, pending] = useSafeActionState(bound, initial);
  useActionToast(state);

  useActionSuccess(state, onClose);

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование кандидата" : "Новый кандидат"}
      wide
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="casting-person-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={onClose}
          >
            Отмена
          </Button>
        </div>
      }
    >
      <form id="casting-person-form" onSubmit={submitKeepingFields(action)} key={person?.id ?? "new"}>
        <PersonFormFields
          projectId={projectId}
          person={person}
          characters={characters}
          showCharacterPicker={!isEdit}
          finance={finance}
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
  finance,
  characterFilter,
}: {
  projectId: string;
  locale: string;
  people: PersonRow[];
  characters: CharacterOpt[];
  canWrite: boolean;
  /** Колонка «Ставка» и поля ставки в форме — фин. условия актёров. */
  finance: FinanceAccess;
  /** `?character=` из адреса: id персонажа или «none»; неизвестное значение — «Все». */
  characterFilter?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [filterValue, setFilterValue] = useState(characterFilter ?? "");
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const confirmDelete = useConfirm();
  const showRate = finance !== "none";

  const { groups, charactersWithoutCandidates } = useMemo(
    () => groupCastingPeople(people, characters),
    [people, characters],
  );
  const filter = resolveCastingFilter(filterValue, groups);
  const visibleGroups = filter ? groups.filter((g) => g.key === filter) : groups;
  const peopleCount = countCastingPeople(visibleGroups);
  const exportCharacters = groups.flatMap((g) => (g.character ? [g.character] : []));
  const filterCharacterId =
    filter && filter !== CASTING_FILTER_NO_CHARACTER ? filter : null;

  function changeFilter(next: string) {
    setFilterValue(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("character", next);
    else url.searchParams.delete("character");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

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

  function deletePerson(person: PersonRow) {
    void confirmDelete({
      title: `Удалить кандидата «${fullNameFromParts(person)}»?`,
      details: () => getCastingPersonDeleteImpactAction(projectId, person.id),
      action: async () => {
        const result = await deleteCastingPersonAction(projectId, person.id);
        if (result.error) return result.error;
        toast.success(result.success ?? "Кандидат удалён");
      },
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
        {exportCharacters.length > 0 ? (
          <CastingCastListExport
            projectId={projectId}
            locale={locale}
            characters={exportCharacters}
            selectedCharacterId={filterCharacterId}
          />
        ) : null}
        {groups.length > 0 ? (
          <Select
            className="w-56"
            value={filter ?? ""}
            onChange={(e) => changeFilter(e.target.value)}
          >
            <option value="">Все персонажи</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.character?.name ?? "Без персонажа"}
              </option>
            ))}
          </Select>
        ) : null}
        <span className="text-sm text-[var(--muted-fg)]">
          {peopleCount} человек в воронке
        </span>
      </div>

      {groups.length === 0 ? (
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
                <th className="py-2 px-3">Статус</th>
                {showRate ? <th className="py-2 px-3">Ставка</th> : null}
                {canWrite ? <th className="py-2 px-3" /> : null}
              </tr>
            </thead>
            {visibleGroups.map((group) => (
              <tbody key={group.key}>
                <tr className="border-b border-[var(--border)]">
                  <th
                    colSpan={3 + (showRate ? 1 : 0) + (canWrite ? 1 : 0)}
                    className="py-2 px-3 pt-4 text-sm font-semibold"
                  >
                    {group.character ? (
                      <Link
                        href={`/${locale}/projects/${projectId}/characters/${group.character.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {group.character.name}
                      </Link>
                    ) : (
                      "Без персонажа"
                    )}
                    <span className="ml-2 font-normal text-[var(--muted-fg)]">
                      {group.rows.length}
                    </span>
                  </th>
                </tr>
                {group.rows.map(({ person, candidate, otherRoles }) => (
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
                      {candidate ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusSelect
                            value={candidate.status}
                            options={castingStatusOptions}
                            disabled={!canWrite || pending}
                            onChange={
                              canWrite
                                ? (next) =>
                                    runStatus(
                                      candidate.id,
                                      next as CastingCandidateStatus,
                                    )
                                : undefined
                            }
                          />
                          {otherRoles.length > 0 ? (
                            <span className="text-[var(--muted-fg)]">
                              ещё: {otherRoles.join(", ")}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[var(--muted-fg)]">—</span>
                      )}
                    </td>
                    {showRate ? (
                      <td className="py-3 px-3 whitespace-nowrap">
                        {person.proposedRate?.toString() ?? "—"}
                      </td>
                    ) : null}
                    {canWrite ? (
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setEditing(person)}
                          >
                            Изменить
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => deletePerson(person)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {!filter && charactersWithoutCandidates.length > 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Без кандидатов:{" "}
          {charactersWithoutCandidates.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ", " : null}
              <Link
                href={`/${locale}/projects/${projectId}/characters/${c.id}`}
                className="hover:text-[var(--accent)]"
              >
                {c.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <PersonModal
        projectId={projectId}
        characters={characters}
        finance={finance}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <PersonModal
        projectId={projectId}
        person={editing ?? undefined}
        characters={characters}
        finance={finance}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
