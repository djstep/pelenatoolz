"use server";

import { CastingCandidateStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  castSnapshotClearedAuditMeta,
  clearCastSnapshotAudited,
  shouldClearCastSnapshot,
} from "@/features/casting/lib/cast-snapshot-reject";
import {
  castingPersonDeleteLines,
  loadCastingPersonDeletePlan,
  type CastingPersonDeleteCounts,
} from "@/features/casting/lib/delete-person";
import { CASTING_PERSON_INPUT_FIELDS } from "@/features/casting/lib/casting-person-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";
import { deleteAuditions } from "@/features/auditions/lib/delete-auditions";
import { approveCastingCandidate } from "@/features/preproduction/lib/approve-casting";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, recordAudit } from "@/shared/audit/with-audit";
import { safePrintUrl } from "@/shared/lib/escape-html";
import { toOwnUploadPath } from "@/shared/lib/own-upload-url";

export type CastingActionState = { error?: string; success?: string };

const personSchema = z.object({
  lastName: z.string().trim().min(1).max(100),
  firstName: z.string().trim().max(100).optional(),
  middleName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z
    .string()
    .optional()
    .transform((v) => (v === "" || !v ? undefined : v))
    .pipe(z.email().optional()),
  agentName: z.string().trim().max(100).optional(),
  agentPhone: z.string().trim().max(30).optional(),
  agentEmail: z
    .string()
    .optional()
    .transform((v) => (v === "" || !v ? undefined : v))
    .pipe(z.email().optional()),
  proposedRate: z.coerce.number().min(0).optional(),
  proposedTerms: z.string().trim().max(5000).optional(),
  tags: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(5000).optional(),
  photoUrl: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .refine((v) => !v || safePrintUrl(v) !== null)
    .transform((v) => (v ? toOwnUploadPath(v) : v)),
  skills: z.string().trim().optional(),
  birthDate: z.string().optional(),
  education: z.string().trim().max(2000).optional(),
  filmography: z.string().trim().max(10000).optional(),
});

function parseSkills(raw: string | undefined) {
  if (!raw?.trim()) return [] as string[];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBirthDate(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(`${raw.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parsePhysicalParams(formData: FormData) {
  const params: Record<string, string> = {};
  for (const key of formData.keys()) {
    if (!key.startsWith("phys_")) continue;
    const paramKey = key.slice(5);
    const val = String(formData.get(key) ?? "").trim();
    if (val) params[paramKey] = val;
  }
  const customKey = String(formData.get("phys_custom_key") ?? "").trim();
  const customVal = String(formData.get("phys_custom_value") ?? "").trim();
  if (customKey && customVal) params[customKey] = customVal;
  return params;
}

function personFromForm(formData: FormData) {
  const parsed = personSchema.safeParse({
    lastName: formData.get("lastName"),
    firstName: formData.get("firstName") || undefined,
    middleName: formData.get("middleName") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    agentName: formData.get("agentName") || undefined,
    agentPhone: formData.get("agentPhone") || undefined,
    agentEmail: formData.get("agentEmail") || undefined,
    proposedRate: formData.get("proposedRate") || undefined,
    proposedTerms: formData.get("proposedTerms") || undefined,
    tags: formData.get("tags") || undefined,
    notes: formData.get("notes") || undefined,
    photoUrl: formData.get("photoUrl") || undefined,
    skills: formData.get("skills") || undefined,
    birthDate: formData.get("birthDate") || undefined,
    education: formData.get("education") || undefined,
    filmography: formData.get("filmography") || undefined,
  });
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "photoUrl")) {
      return { error: "Фото: только ссылка http(s) или загруженный файл" as const };
    }
    return { error: "Проверьте данные кандидата" as const };
  }
  const { birthDate: birthRaw, ...rest } = parsed.data;
  return {
    data: {
      ...rest,
      birthDate: parseBirthDate(birthRaw),
      skills: parseSkills(parsed.data.skills),
      physicalParams: parsePhysicalParams(formData),
    },
  };
}

/** Ставка и условия из формы — только с фин. правкой актёров, иначе сервер их не пишет. */
function castingPersonWritable<T extends object>(
  ctx: { canFinanceWrite: (target: "actors") => boolean },
  data: T,
) {
  return pickFinanceFields(data, CASTING_PERSON_INPUT_FIELDS, ctx.canFinanceWrite("actors"));
}

function revalidateCasting(projectId: string, characterId?: string, personId?: string) {
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting`);
  revalidatePath(`/ru/projects/${projectId}/characters`);
  if (characterId) {
    revalidatePath(`/ru/projects/${projectId}/characters/${characterId}`);
  }
  if (personId) {
    revalidatePath(`/ru/projects/${projectId}/preproduction/casting/${personId}`);
  }
}

export async function createCastingPersonAction(
  projectId: string,
  _prev: CastingActionState,
  formData: FormData,
): Promise<CastingActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const parsed = personFromForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const characterId = String(formData.get("characterId") ?? "").trim();
  const { skills, physicalParams, ...personData } = castingPersonWritable(ctx, parsed.data);

  if (characterId) {
    try {
      await assertInProject("Character", characterId, projectId);
    } catch (error) {
      if (isNotInProjectError(error)) return { error: "Объект не найден" };
      throw error;
    }
  }

  const person = await prisma.castingPerson.create({
    data: {
      projectId,
      ...personData,
      skills,
      physicalParams,
    },
  });

  if (characterId) {
    await prisma.castingCandidate.create({
      data: {
        projectId,
        characterId,
        personId: person.id,
      },
    });
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.castingPerson,
    entityId: person.id,
    action: "CREATE",
    summary: `Добавлен кандидат ${person.lastName}`,
  });

  revalidateCasting(projectId);
  return { success: "Кандидат добавлен" };
}

export async function updateCastingPersonAction(
  projectId: string,
  personId: string,
  _prev: CastingActionState,
  formData: FormData,
): Promise<CastingActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.castingPerson.findFirst({
    where: { id: personId, projectId },
  });
  if (!existing) return { error: "Кандидат не найден" };

  const parsed = personFromForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { skills, physicalParams, ...personData } = castingPersonWritable(ctx, parsed.data);

  await prisma.castingPerson.update({
    where: { id: personId },
    data: { ...personData, skills, physicalParams },
  });

  revalidateCasting(projectId, undefined, personId);
  return { success: "Кандидат сохранён" };
}

export async function updateCastingCandidateStatusAction(
  projectId: string,
  candidateId: string,
  status: CastingCandidateStatus,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  if (status === CastingCandidateStatus.APPROVED) {
    try {
      const result = await approveCastingCandidate(projectId, candidateId);
      revalidateCasting(projectId, result.characterId);
      const replaced = result.replacedPrevious;
      return {
        success: replaced
          ? `${result.personName} утверждён на роль «${result.characterName}» (замена предыдущего актёра)`
          : `${result.personName} утверждён на роль «${result.characterName}»`,
      };
    } catch (error) {
      if (isNotInProjectError(error)) return { error: "Объект не найден" };
      return { error: "Не удалось утвердить кандидата" };
    }
  }

  const existing = await prisma.castingCandidate.findFirst({
    where: { id: candidateId, projectId },
    select: {
      status: true,
      characterId: true,
      character: { select: { name: true, sourceCastingCandidateId: true } },
      person: { select: { lastName: true, firstName: true, middleName: true } },
    },
  });
  if (!existing) return { error: "Заявка не найдена" };

  await prisma.castingCandidate.updateMany({
    where: { id: candidateId, projectId },
    data: { status, statusChangedAt: new Date() },
  });

  if (
    shouldClearCastSnapshot(status, candidateId, existing.character.sourceCastingCandidateId)
  ) {
    await clearCastSnapshotAudited(
      ctx,
      castSnapshotClearedAuditMeta({
        projectId,
        candidateId,
        characterId: existing.characterId,
        characterName: existing.character.name,
        personName: fullNameFromParts(existing.person),
        previousStatus: existing.status,
      }),
      async () => {
        const { count } = await prisma.character.updateMany({
          where: {
            id: existing.characterId,
            projectId,
            sourceCastingCandidateId: candidateId,
          },
          data: {
            castSnapshot: Prisma.DbNull,
            sourceCastingCandidateId: null,
          },
        });
        return count;
      },
    );
  }

  revalidateCasting(projectId, existing.characterId);
  return { success: "Статус обновлён" };
}

export async function addCastingApplicationAction(
  projectId: string,
  personId: string,
  characterId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const person = await prisma.castingPerson.findFirst({
    where: { id: personId, projectId },
  });
  if (!person) return { error: "Кандидат не найден" };

  const character = await prisma.character.findFirst({
    where: { id: characterId, projectId },
  });
  if (!character) return { error: "Персонаж не найден" };

  await prisma.castingCandidate.upsert({
    where: {
      characterId_personId: { characterId, personId },
    },
    create: { projectId, characterId, personId },
    update: {},
  });

  revalidateCasting(projectId);
  return { success: `Добавлена заявка на «${character.name}»` };
}

export async function deleteCastingPersonAction(
  projectId: string,
  personId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  try {
    await assertInProject("CastingPerson", personId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Кандидат не найден" };
    throw error;
  }

  let deleted: { name: string; counts: CastingPersonDeleteCounts };
  try {
    deleted = await auditMutation(
      ctx,
      () =>
        // Отказ и список одиночных проб — в той же транзакции, что удаление,
        // а не из данных окна подтверждения.
        prisma.$transaction(async (tx) => {
          const plan = await loadCastingPersonDeletePlan(tx, projectId, personId);
          if (!plan) throw new CastingPersonDeleteRefused("Кандидат не найден");
          if (plan.refusal) throw new CastingPersonDeleteRefused(plan.refusal);
          await deleteAuditions(tx, projectId, plan.soloAuditionIds);
          await tx.castingPerson.deleteMany({ where: { id: personId, projectId } });
          return { name: plan.name, counts: plan.counts };
        }),
      null,
      {
        projectId,
        entityType: AuditEntityType.castingPerson,
        entityId: personId,
        action: "DELETE",
        summary: (_, r) => `Удалён кандидат кастинга «${r.name}»`,
        changes: (_, r) => r.counts,
      },
    );
  } catch (error) {
    if (error instanceof CastingPersonDeleteRefused) return { error: error.message };
    throw error;
  }

  revalidateCasting(projectId);
  revalidatePath(`/ru/projects/${projectId}/preproduction/auditions`);
  return { success: `Кандидат «${deleted.name}» удалён` };
}

class CastingPersonDeleteRefused extends Error {}

/** Что удалится вместе с кандидатом — для окна подтверждения. */
export async function getCastingPersonDeleteImpactAction(
  projectId: string,
  personId: string,
): Promise<string[]> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return [];
  try {
    await assertInProject("CastingPerson", personId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return [];
    throw error;
  }
  const plan = await loadCastingPersonDeletePlan(prisma, projectId, personId);
  if (!plan) return [];
  if (plan.refusal) return [plan.refusal];
  return castingPersonDeleteLines(plan.counts);
}
