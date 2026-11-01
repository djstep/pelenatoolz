import { CastingCandidateStatus } from "@prisma/client";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";
import { impactLines } from "@/shared/lib/plural";

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;
/** Клиент базы или транзакция. */
type Db = Pick<
  Tx,
  | "castingPerson"
  | "character"
  | "castingCandidateComment"
  | "auditionScheduleCandidate"
  | "audition"
  | "actorAvailabilityRow"
>;

/**
 * Почему кандидата нельзя удалить: утверждён на роль или персонаж хранит его снимок.
 * null — удалить можно. По ФИО с актёрами не сверяем: связь с ними только через утверждение.
 */
export function castingPersonDeleteRefusal(
  candidates: { id: string; status: CastingCandidateStatus; characterName: string }[],
  snapshotHolders: { name: string; sourceCastingCandidateId: string | null }[],
): string | null {
  const approved = candidates.find((c) => c.status === CastingCandidateStatus.APPROVED);
  if (approved) {
    return `Кандидат утверждён на роль «${approved.characterName}». Чтобы удалить, поставьте заявке на «${approved.characterName}» статус «Отказ»`;
  }
  for (const holder of snapshotHolders) {
    const candidate = candidates.find((c) => c.id === holder.sourceCastingCandidateId);
    if (!candidate) continue;
    return `Персонаж «${holder.name}» хранит снимок этого кандидата. Чтобы удалить, поставьте заявке на «${candidate.characterName}» статус «Отказ»`;
  }
  return null;
}

/** Пробы кандидата: где он один — удаляются, где есть другие участники — остаются без него. */
export function splitPersonAuditions(auditions: { id: string; actorCount: number }[]) {
  return {
    soloIds: auditions.filter((a) => a.actorCount <= 1).map((a) => a.id),
    sharedCount: auditions.filter((a) => a.actorCount > 1).length,
  };
}

export type CastingPersonDeleteCounts = {
  applications: number;
  comments: number;
  scheduleSlots: number;
  auditionsDeleted: number;
  auditionsLeft: number;
  availabilityRows: number;
};

/** Строки окна подтверждения. */
export function castingPersonDeleteLines(counts: CastingPersonDeleteCounts): string[] {
  return [
    ...impactLines([
      [counts.applications, "Удалятся заявки на роли"],
      [counts.comments, "Удалятся комментарии к заявкам"],
      [counts.scheduleSlots, "Кандидат уберётся из слотов планирования проб"],
    ]),
    ...(counts.auditionsDeleted > 0
      ? [`Удалятся пробы: ${counts.auditionsDeleted} (видео останутся в «Файлах проекта»)`]
      : []),
    ...impactLines([
      [counts.auditionsLeft, "Кандидат уберётся из проб с другими участниками"],
      [counts.availabilityRows, "Удалится строка календаря занятости"],
    ]),
  ];
}

/**
 * Что будет при удалении кандидата — одно и для окна подтверждения, и для самого
 * удаления (там — внутри транзакции). null — кандидата нет в проекте.
 */
export async function loadCastingPersonDeletePlan(
  db: Db,
  projectId: string,
  personId: string,
) {
  const person = await db.castingPerson.findFirst({
    where: { id: personId, projectId },
    select: {
      lastName: true,
      firstName: true,
      middleName: true,
      candidates: {
        select: { id: true, status: true, character: { select: { name: true } } },
      },
    },
  });
  if (!person) return null;

  const candidates = person.candidates.map((c) => ({
    id: c.id,
    status: c.status,
    characterName: c.character.name,
  }));
  const candidateIds = candidates.map((c) => c.id);
  const candidateWhere = { personId, projectId };

  const [snapshotHolders, comments, scheduleSlots, auditions, availabilityRows] =
    await Promise.all([
      candidateIds.length
        ? db.character.findMany({
            where: { projectId, sourceCastingCandidateId: { in: candidateIds } },
            select: { name: true, sourceCastingCandidateId: true },
          })
        : Promise.resolve([]),
      db.castingCandidateComment.count({ where: { candidate: candidateWhere } }),
      db.auditionScheduleCandidate.count({ where: { candidate: candidateWhere } }),
      db.audition.findMany({
        where: { projectId, actors: { some: { personId } } },
        select: { id: true, _count: { select: { actors: true } } },
      }),
      db.actorAvailabilityRow.count({ where: { projectId, castingPersonId: personId } }),
    ]);

  const { soloIds, sharedCount } = splitPersonAuditions(
    auditions.map((a) => ({ id: a.id, actorCount: a._count.actors })),
  );

  return {
    name: fullNameFromParts(person),
    refusal: castingPersonDeleteRefusal(candidates, snapshotHolders),
    soloAuditionIds: soloIds,
    counts: {
      applications: candidates.length,
      comments,
      scheduleSlots,
      auditionsDeleted: soloIds.length,
      auditionsLeft: sharedCount,
      availabilityRows,
    } satisfies CastingPersonDeleteCounts,
  };
}
