/**
 * Фин. значения при утверждении кандидата (кастинг — ставка и условия актёра, скаут — стоимость
 * площадки). Значения кандидата вносит только тот, у кого есть фин. правка, поэтому:
 * - с фин. правкой источника — всё как у кандидата (пустое стирает);
 * - без фин. правки: у кандидата заполнено — переносится; пусто и утверждается тот же человек /
 *   та же площадка — прежнее значение сохраняется; пусто и другой — пусто (чужое не наследуется).
 */
function pick<T>(
  candidateValue: T | null,
  existingValue: T | null,
  canWriteFinance: boolean,
  same: boolean,
): T | null {
  if (canWriteFinance || candidateValue != null) return candidateValue;
  return same ? existingValue : null;
}

function emptyToNull(value: string | null | undefined) {
  return value != null && value.trim() !== "" ? value : null;
}

export type ApprovedActorFinance = {
  actor: { shiftRate: number | null; specialConditions: string | null };
  snapshot: { proposedRate: number | null; proposedTerms: string | null; shiftRate: number | null };
};

export function resolveApprovedActorFinance(input: {
  canWriteFinance: boolean;
  /** Утверждается тот же человек (`CastingPerson.id`), что уже утверждён на роль. */
  samePerson: boolean;
  candidate: { proposedRate: number | null; proposedTerms: string | null };
  existingActor: { shiftRate: number | null; specialConditions: string | null } | null;
  existingSnapshot: {
    proposedRate?: number | null;
    proposedTerms?: string | null;
    shiftRate?: number | null;
  } | null;
}): ApprovedActorFinance {
  const { canWriteFinance, samePerson, candidate, existingActor, existingSnapshot } = input;
  const rate = candidate.proposedRate;
  const terms = emptyToNull(candidate.proposedTerms);
  const keepRate = !canWriteFinance && rate == null && samePerson;
  const shiftRate = pick(rate, existingActor?.shiftRate ?? null, canWriteFinance, samePerson);
  return {
    actor: {
      shiftRate,
      specialConditions: pick(
        terms,
        existingActor?.specialConditions ?? null,
        canWriteFinance,
        samePerson,
      ),
    },
    snapshot: {
      proposedRate: keepRate ? (existingSnapshot?.proposedRate ?? null) : rate,
      proposedTerms: pick(
        terms,
        existingSnapshot?.proposedTerms ?? null,
        canWriteFinance,
        samePerson,
      ),
      shiftRate,
    },
  };
}

export function resolveApprovedScoutCost(input: {
  canWriteFinance: boolean;
  /** Эта площадка (`ScoutCandidate.id`) уже утверждена для объекта. */
  sameCandidate: boolean;
  candidateCost: number | null;
  existingCost: number | null;
}): number | null {
  return pick(
    input.candidateCost,
    input.existingCost,
    input.canWriteFinance,
    input.sameCandidate,
  );
}
