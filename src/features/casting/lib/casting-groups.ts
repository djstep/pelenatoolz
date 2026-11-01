/** Значение фильтра «Без персонажа» в адресе (`?character=none`). */
export const CASTING_FILTER_NO_CHARACTER = "none";

type CharacterRef = { id: string; name: string };

type PersonLike = {
  id: string;
  candidates: { id: string; character: CharacterRef }[];
};

export type CastingGroupRow<P extends PersonLike> = {
  person: P;
  /** Заявка на персонажа группы; `null` в группе «Без персонажа». */
  candidate: P["candidates"][number] | null;
  /** Имена других персонажей, на которых у человека есть заявки. */
  otherRoles: string[];
};

export type CastingGroup<P extends PersonLike> = {
  /** id персонажа или `CASTING_FILTER_NO_CHARACTER`. */
  key: string;
  /** `null` — группа «Без персонажа». */
  character: CharacterRef | null;
  rows: CastingGroupRow<P>[];
};

/**
 * Группы кастинга: персонажи с кандидатами в порядке `characters`,
 * последней — «Без персонажа» (люди без заявок). Человек с несколькими
 * заявками попадает в группу каждого своего персонажа.
 */
export function groupCastingPeople<P extends PersonLike>(
  people: P[],
  characters: CharacterRef[],
): { groups: CastingGroup<P>[]; charactersWithoutCandidates: CharacterRef[] } {
  const groups: CastingGroup<P>[] = [];
  const charactersWithoutCandidates: CharacterRef[] = [];

  for (const character of characters) {
    const rows: CastingGroupRow<P>[] = [];
    for (const person of people) {
      const candidate = person.candidates.find(
        (c) => c.character.id === character.id,
      );
      if (!candidate) continue;
      rows.push({
        person,
        candidate,
        otherRoles: person.candidates
          .filter((c) => c !== candidate)
          .map((c) => c.character.name)
          .sort((a, b) => a.localeCompare(b, "ru")),
      });
    }
    if (rows.length > 0) groups.push({ key: character.id, character, rows });
    else charactersWithoutCandidates.push(character);
  }

  const withoutRoles = people.filter((p) => p.candidates.length === 0);
  if (withoutRoles.length > 0) {
    groups.push({
      key: CASTING_FILTER_NO_CHARACTER,
      character: null,
      rows: withoutRoles.map((person) => ({
        person,
        candidate: null,
        otherRoles: [],
      })),
    });
  }

  return { groups, charactersWithoutCandidates };
}

/** Значение фильтра из адреса: только ключ существующей группы, иначе `null` («Все»). */
export function resolveCastingFilter(
  raw: string | null | undefined,
  groups: { key: string }[],
): string | null {
  if (!raw) return null;
  return groups.some((g) => g.key === raw) ? raw : null;
}

/** Уникальные люди в группах (человек в нескольких группах считается один раз). */
export function countCastingPeople(
  groups: { rows: { person: { id: string } }[] }[],
): number {
  const ids = new Set<string>();
  for (const g of groups) for (const r of g.rows) ids.add(r.person.id);
  return ids.size;
}
