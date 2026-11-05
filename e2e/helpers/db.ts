import "./use-e2e-database";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { E2E_PROJECT_NAME, E2E_ROLES, NAMES } from "../fixtures/data";

config({ quiet: true });

/** База тестов: только из `.env.e2e`, проверена в `use-e2e-database`. */
export function e2eDb() {
  return new PrismaClient();
}

export type E2EContext = {
  projectId: string;
  /** Проект, где тестовых пользователей нет (проверка чужого проекта). */
  foreignProjectId: string | null;
  days: { dayNumber: number; id: string }[];
  departmentId: string;
  /** Цех со сметой из сида (снимки редактора сметы). */
  smetaDepartmentId: string | null;
  sceneId: string;
  locationId: string;
  characterId: string;
  castingPersonId: string;
  /** Позиция ресурса со ставкой и ставкой за км (игровой транспорт). */
  vehicle: { categoryId: string; itemId: string };
  /** Текущая версия сценария (в сиде с волны fix/ui-tails; в старом проекте её может не быть). */
  scriptVersionId: string | null;
  /** Записи для снимков карточек (волна 5). */
  paymentId: string | null;
  contractId: string | null;
  counterpartyId: string | null;
  auditionId: string | null;
  scoutCandidateId: string | null;
};

/** Id проекта «E2E приёмка», его дней и чужого проекта — для адресов в тестах. */
export async function loadE2EContext(db: PrismaClient): Promise<E2EContext> {
  const owner = await db.user.findUnique({ where: { email: E2E_ROLES.producer.email }, select: { id: true } });
  if (!owner) throw new Error("Нет e2e-producer — запустите npx tsx scripts/e2e-seed.ts");
  const project = await db.project.findFirst({
    where: { name: E2E_PROJECT_NAME, ownerUserId: owner.id },
    select: {
      id: true,
      shootDays: { select: { id: true, dayNumber: true }, orderBy: { dayNumber: "asc" } },
      departments: { select: { id: true, name: true } },
      scenes: { select: { id: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      locations: { select: { id: true }, take: 1 },
      characters: { select: { id: true }, where: { name: NAMES.character } },
      castingPeople: { select: { id: true }, take: 1 },
      resourceCategories: { select: { id: true, items: { select: { id: true } } }, where: { tracksMileage: true } },
      scriptVersions: { select: { id: true }, where: { isCurrent: true }, take: 1 },
      cashPayments: { select: { id: true }, take: 1 },
      contracts: { select: { id: true }, where: { number: NAMES.contract }, take: 1 },
      counterparties: { select: { id: true }, where: { name: NAMES.counterparty }, take: 1 },
      auditions: { select: { id: true }, take: 1 },
      scoutCandidates: { select: { id: true }, where: { title: NAMES.scout }, take: 1 },
    },
  });
  if (!project) throw new Error(`Нет проекта «${E2E_PROJECT_NAME}» — запустите npx tsx scripts/e2e-seed.ts`);
  const emails = Object.values(E2E_ROLES).map((r) => r.email);
  const foreign = await db.project.findFirst({
    where: { memberships: { none: { user: { email: { in: emails } } } } },
    select: { id: true },
  });
  return {
    projectId: project.id,
    foreignProjectId: foreign?.id ?? null,
    days: project.shootDays,
    departmentId: project.departments.find((d) => d.name === NAMES.transportDepartment)!.id,
    smetaDepartmentId: project.departments.find((d) => d.name === NAMES.smetaDepartment)?.id ?? null,
    sceneId: project.scenes[0].id,
    locationId: project.locations[0].id,
    characterId: project.characters[0].id,
    castingPersonId: project.castingPeople[0].id,
    vehicle: {
      categoryId: project.resourceCategories[0].id,
      itemId: project.resourceCategories[0].items[0].id,
    },
    scriptVersionId: project.scriptVersions[0]?.id ?? null,
    paymentId: project.cashPayments[0]?.id ?? null,
    contractId: project.contracts[0]?.id ?? null,
    counterpartyId: project.counterparties[0]?.id ?? null,
    auditionId: project.auditions[0]?.id ?? null,
    scoutCandidateId: project.scoutCandidates[0]?.id ?? null,
  };
}
