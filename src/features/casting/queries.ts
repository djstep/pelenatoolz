import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

export async function listCastingPeople(projectId: string) {
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

  return people.map((p) => ({
    ...p,
    proposedRate: dec(p.proposedRate),
  }));
}

export async function getCastingPerson(projectId: string, personId: string) {
  const person = await prisma.castingPerson.findFirst({
    where: { id: personId, projectId },
    include: {
      candidates: {
        include: {
          character: {
            select: {
              id: true,
              name: true,
              castSnapshot: true,
              sourceCastingCandidateId: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!person) return null;

  return {
    ...person,
    proposedRate: dec(person.proposedRate),
  };
}

export async function listCharactersForCasting(projectId: string) {
  return prisma.character.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
