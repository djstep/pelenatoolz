"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { CastingCandidateStatus } from "@prisma/client";
import Link from "next/link";
import {
  addCastingApplicationAction,
  updateCastingCandidateStatusAction,
  updateCastingPersonAction,
  type CastingActionState,
} from "@/features/casting/actions";
import {
  PHYSICAL_PARAM_LABELS,
  fullNameFromParts,
} from "@/features/preproduction/lib/snapshots";
import {
  castingStatusOptions,
} from "@/features/preproduction/lib/status-labels";
import { StatusSelect } from "@/features/preproduction/components/status-select";
import { AvailabilityMiniPreview } from "@/features/actor-availability/components/availability-mini-preview";
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { PersonFormFields } from "./casting-person-form-fields";

const initial: CastingActionState = {};

type PersonDetail = NonNullable<
  Awaited<ReturnType<typeof import("@/features/casting/queries").getCastingPerson>>
>;

type CharacterOpt = { id: string; name: string };

export function CastingPersonDetail({
  projectId,
  locale,
  person,
  characters,
  canWrite,
  availabilityMini,
}: {
  projectId: string;
  locale: string;
  person: PersonDetail;
  characters: CharacterOpt[];
  canWrite: boolean;
  availabilityMini?: {
    rowId?: string;
    manualDays: Record<string, Record<string, { status: string; comment: string | null }>>;
    kppBusySerialized: Record<string, string[]>;
  };
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const bound = updateCastingPersonAction.bind(null, projectId, person.id);
  const [state, action, formPending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) setEditOpen(false);
  }, [state.success]);

  const physical =
    person.physicalParams && typeof person.physicalParams === "object"
      ? (person.physicalParams as Record<string, string>)
      : {};

  const linkedCharacterIds = new Set(person.candidates.map((c) => c.character.id));
  const availableCharacters = characters.filter((c) => !linkedCharacterIds.has(c.id));

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

  function addApplication(characterId: string) {
    startTransition(async () => {
      const result = await addCastingApplicationAction(
        projectId,
        person.id,
        characterId,
      );
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/preproduction/casting`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← Кастинг
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">
              {fullNameFromParts(person)}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {person.phone ?? "—"}
              {person.agentName ? ` · Агент: ${person.agentName}` : ""}
            </p>
          </div>
          {canWrite ? (
            <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
              Редактировать
            </Button>
          ) : null}
        </div>
      </div>

      {person.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.photoUrl}
          alt=""
          className="max-h-64 rounded-xl border border-[var(--border)] object-cover"
        />
      ) : null}

      {availabilityMini ? (
        <AvailabilityMiniPreview
          projectId={projectId}
          locale={locale}
          rowId={availabilityMini.rowId}
          castingPersonId={person.id}
          manualDays={availabilityMini.manualDays}
          kppBusySerialized={availabilityMini.kppBusySerialized}
          canWrite={canWrite}
        />
      ) : null}

      <section className="glass-card grid gap-4 p-5 md:grid-cols-2 text-sm">
        <div>
          <p className="text-[var(--muted-fg)]">Email</p>
          <p>{person.email ?? "—"}</p>
        </div>
        <div>
          <p className="text-[var(--muted-fg)]">Контакт агента</p>
          <p>
            {[person.agentPhone, person.agentEmail].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <div>
          <p className="text-[var(--muted-fg)]">Физ. параметры</p>
          <p>
            {Object.keys(physical).length > 0
              ? Object.entries(physical)
                  .map(([k, v]) => `${PHYSICAL_PARAM_LABELS[k] ?? k}: ${v}`)
                  .join("; ")
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[var(--muted-fg)]">Умения</p>
          <p>{person.skills?.join(", ") || "—"}</p>
        </div>
        <div>
          <p className="text-[var(--muted-fg)]">Ставка (заявленная)</p>
          <p>{person.proposedRate?.toString() ?? "—"}</p>
        </div>
        <div>
          <p className="text-[var(--muted-fg)]">Условия</p>
          <p>{person.proposedTerms ?? "—"}</p>
        </div>
        {person.notes ? (
          <div className="md:col-span-2">
            <p className="text-[var(--muted-fg)]">Заметки</p>
            <p className="whitespace-pre-wrap">{person.notes}</p>
          </div>
        ) : null}
      </section>

      <section className="glass-card space-y-4 p-5">
        <h2 className="font-semibold">Заявки на роли</h2>
        {person.candidates.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Нет привязанных персонажей.</p>
        ) : (
          <ul className="space-y-2">
            {person.candidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
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
                      ? (next) => runStatus(c.id, next as CastingCandidateStatus)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {canWrite && availableCharacters.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
            <div className="min-w-[12rem] flex-1">
              <Label htmlFor="addCharacter">Добавить роль</Label>
              <Select
                id="addCharacter"
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) addApplication(id);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Выберите персонажа…
                </option>
                {availableCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </section>

      {editOpen ? (
        <div className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Редактирование</h2>
          <form action={action} className="space-y-4">
            <PersonFormFields projectId={projectId} person={person} />
            <div className="flex gap-3">
              <Button type="submit" disabled={formPending}>
                {formPending ? "…" : "Сохранить"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
