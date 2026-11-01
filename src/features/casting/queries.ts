import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";
import { pickFinanceFields } from "@/shared/lib/finance-fields";
import { CASTING_PERSON_FIELDS } from "@/features/casting/lib/casting-person-fields";

/** `canFinanceRead` — фин. просмотр актёров (`ctx.canFinanceRead("actors")`). */
export async function listCastingPeople(projectId: string, canFinanceRead: boolean) {
  const people = await prisma.castingPerson.findMany({
    where: { projectId },
    include: {
      candidates: {
        include: {
          character: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return people.map((p) =>
    pickFinanceFields(
      { ...p, proposedRate: dec(p.proposedRate) },
      CASTING_PERSON_FIELDS,
      canFinanceRead,
    ),
  );
}

/** `canFinanceRead` — фин. просмотр актёров (`ctx.canFinanceRead("actors")`). */
export async function getCastingPerson(
  projectId: string,
  personId: string,
  canFinanceRead: boolean,
) {
  const person = await prisma.castingPerson.findFirst({
    where: { id: personId, projectId },
    include: {
      candidates: {
        include: {
          // Снимок утверждённого актёра на карточке кандидата не нужен — в браузер не уходит.
          character: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!person) return null;

  return pickFinanceFields(
    { ...person, proposedRate: dec(person.proposedRate) },
    CASTING_PERSON_FIELDS,
    canFinanceRead,
  );
}

export async function listCharactersForCasting(projectId: string) {
  return prisma.character.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
