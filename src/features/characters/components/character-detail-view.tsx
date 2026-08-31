"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  updateCharacterCastSnapshotAction,
  updateCharacterRequirementsAction,
  type CharacterActionState,
} from "@/features/characters/actions";
import {
  updateActorAction,
  type ActorActionState,
} from "@/features/actors/actions";
import { castingStatusLabels } from "@/features/preproduction/lib/status-labels";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";
import {
  ActorPayrollBlock,
  seedExtras,
  seedOvertime,
} from "@/features/actors/components/actor-payroll-block";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useActionToast } from "@/shared/ui/toast";

const initial: CharacterActionState = {};
const actorInitial: ActorActionState = {};

type CharacterDetail = NonNullable<
  Awaited<ReturnType<typeof import("@/features/characters/queries").getCharacterDetail>>
>;

export function CharacterDetailView({
  projectId,
  locale,
  character,
  canWriteScript,
  canWriteCast,
}: {
  projectId: string;
  locale: string;
  character: CharacterDetail;
  canWriteScript: boolean;
  canWriteCast: boolean;
}) {
  const reqBound = updateCharacterRequirementsAction.bind(
    null,
    projectId,
    character.id,
  );
  const [reqState, reqAction, reqPending] = useActionState(reqBound, initial);
  useActionToast(reqState);

  const snapBound = updateCharacterCastSnapshotAction.bind(
    null,
    projectId,
    character.id,
  );
  const [snapState, snapAction, snapPending] = useActionState(snapBound, initial);
  useActionToast(snapState);

  const actor = character.actors[0];
  const snapshot = character.snapshot;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/characters`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← Все персонажи
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold">{character.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          {character.scenes.length} сцен · план{" "}
          {character.planSeconds > 0
            ? formatSecondsMmSs(character.planSeconds)
            : "—"}
        </p>
      </div>

      <section className="glass-card space-y-4 p-5">
        <h2 className="font-semibold">Требования к роли</h2>
        <form action={reqAction} className="space-y-3">
          <div>
            <Label htmlFor="description">Описание персонажа</Label>
            <textarea
              id="description"
              name="description"
              rows={2}
              className="glass-input w-full resize-y px-3 py-2 text-sm"
              defaultValue={character.description ?? ""}
              disabled={!canWriteScript}
            />
          </div>
          <div>
            <Label htmlFor="roleRequirements">Типаж / возраст / заметки</Label>
            <textarea
              id="roleRequirements"
              name="roleRequirements"
              rows={2}
              className="glass-input w-full resize-y px-3 py-2 text-sm"
              placeholder="Например: женщина 35–45, спокойный типаж"
              defaultValue={character.roleRequirements ?? ""}
              disabled={!canWriteScript}
            />
          </div>
          {canWriteScript ? (
            <Button type="submit" disabled={reqPending}>
              {reqPending ? "…" : "Сохранить требования"}
            </Button>
          ) : null}
        </form>
      </section>

      <section className="glass-card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Кандидаты на роль</h2>
          <Link
            href={`/${locale}/projects/${projectId}/preproduction/casting`}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Открыть кастинг →
          </Link>
        </div>
        {character.castingCandidates.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Кандидаты не добавлены.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {character.castingCandidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <span>
                  {fullNameFromParts(c.person)}
                  {c.person.phone ? ` · ${c.person.phone}` : ""}
                </span>
                <span className="rounded-full bg-[var(--glass-badge-bg)] px-2 py-0.5 text-xs">
                  {castingStatusLabels[c.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {snapshot ? (
        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Утверждённый актёр (снимок)</h2>
          <p className="text-xs text-[var(--muted-fg)]">
            Данные скопированы при утверждении. Редактирование здесь не меняет карточку
            в Кастинге.
          </p>
          <form action={snapAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div>
                <span className="text-[var(--muted-fg)]">ФИО</span>
                <p className="font-medium">
                  {fullNameFromParts({
                    lastName: snapshot.lastName,
                    firstName: snapshot.firstName,
                    middleName: snapshot.middleName,
                  })}
                </p>
              </div>
              <div>
                <span className="text-[var(--muted-fg)]">Телефон</span>
                <p>{snapshot.phone ?? "—"}</p>
              </div>
              <div>
                <span className="text-[var(--muted-fg)]">Агент</span>
                <p>{snapshot.agentName ?? "—"}</p>
              </div>
              <div>
                <span className="text-[var(--muted-fg)]">Умения</span>
                <p>{snapshot.skills?.join(", ") || "—"}</p>
              </div>
            </div>
            <div>
              <Label htmlFor="riderNotes">Райдер / доп. условия</Label>
              <textarea
                id="riderNotes"
                name="riderNotes"
                rows={3}
                className="glass-input w-full resize-y px-3 py-2 text-sm"
                defaultValue={snapshot.riderNotes ?? ""}
                disabled={!canWriteCast}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="shiftRate">Ставка за смену</Label>
                <Input
                  id="shiftRate"
                  name="shiftRate"
                  type="number"
                  min={0}
                  defaultValue={snapshot.shiftRate ?? undefined}
                  disabled={!canWriteCast}
                />
              </div>
              <div>
                <Label htmlFor="proposedTerms">Финансовые условия</Label>
                <Input
                  id="proposedTerms"
                  name="proposedTerms"
                  defaultValue={snapshot.proposedTerms ?? ""}
                  disabled={!canWriteCast}
                />
              </div>
            </div>
            {canWriteCast ? (
              <Button type="submit" disabled={snapPending}>
                {snapPending ? "…" : "Сохранить снимок"}
              </Button>
            ) : null}
          </form>

          {actor && canWriteCast ? (
            <CharacterPayrollSection
              projectId={projectId}
              characterId={character.id}
              actor={actor}
            />
          ) : null}
        </section>
      ) : null}

      <section className="glass-card p-5">
        <h2 className="mb-3 font-semibold">Сцены с персонажем</h2>
        <ul className="space-y-2 text-sm">
          {character.scenes.map((sc) => (
            <li key={sc.sceneId} className="border-b border-[var(--border)]/50 pb-2">
              <span className="font-medium">
                {sc.scene.episodeNumber}.{sc.scene.number}
                {sc.scene.postfix}
              </span>
              {sc.scene.summary ? ` — ${sc.scene.summary}` : ""}
              {sc.scene.locations[0]?.location ? (
                <span className="text-[var(--muted-fg)]">
                  {" "}
                  · {sc.scene.locations[0].location.name}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type ActorPayroll = CharacterDetail["actors"][number];

function CharacterPayrollSection({
  projectId,
  characterId,
  actor,
}: {
  projectId: string;
  characterId: string;
  actor: ActorPayroll;
}) {
  const bound = updateActorAction.bind(null, projectId, actor.id);
  const [state, action, pending] = useActionState(bound, actorInitial);
  useActionToast(state);

  return (
    <form action={action} className="border-t border-[var(--border)] pt-4">
      <input type="hidden" name="lastName" value={actor.lastName} />
      <input type="hidden" name="firstName" value={actor.firstName ?? ""} />
      <input type="hidden" name="middleName" value={actor.middleName ?? ""} />
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="phone1" value={actor.phone1 ?? ""} />
      <input type="hidden" name="email" value={actor.email ?? ""} />
      <input type="hidden" name="agentName" value={actor.agentName ?? ""} />
      <input type="hidden" name="agentPhone" value={actor.agentPhone ?? ""} />
      <input type="hidden" name="agentEmail" value={actor.agentEmail ?? ""} />
      <h3 className="mb-3 font-semibold">Гонорар и переработки</h3>
      <ActorPayrollBlock
        shiftRate={actor.shiftRate ? Number(actor.shiftRate) : 0}
        forceMajeurePct={actor.forceMajeurePct ? Number(actor.forceMajeurePct) : 0}
        shiftHoursMin={actor.shiftHoursMin}
        unpaidOvertimeMin={actor.unpaidOvertimeMin}
        overtime={seedOvertime(actor.overtimeRates)}
        extras={seedExtras(actor.extraPayments)}
      />
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? "…" : "Сохранить гонорар"}
      </Button>
    </form>
  );
}
