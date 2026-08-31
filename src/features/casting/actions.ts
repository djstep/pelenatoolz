"use server";

import { CastingCandidateStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveCastingCandidate } from "@/features/preproduction/lib/approve-casting";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";

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
  photoUrl: z.string().trim().max(2000).optional(),
  skills: z.string().trim().optional(),
});

function parseSkills(raw: string | undefined) {
  if (!raw?.trim()) return [] as string[];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
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
  });
  if (!parsed.success) return { error: "Проверьте данные кандидата" as const };
  return {
    data: {
      ...parsed.data,
      skills: parseSkills(parsed.data.skills),
      physicalParams: parsePhysicalParams(formData),
    },
  };
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
  const { skills, physicalParams, ...personData } = parsed.data;

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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "casting_person",
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

  const { skills, physicalParams, ...personData } = parsed.data;

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
      return {
        success: `${result.personName} утверждён на роль «${result.characterName}»`,
      };
    } catch {
      return { error: "Не удалось утвердить кандидата" };
    }
  }

  await prisma.castingCandidate.updateMany({
    where: { id: candidateId, projectId },
    data: { status, statusChangedAt: new Date() },
  });

  revalidateCasting(projectId);
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

  await prisma.castingPerson.deleteMany({ where: { id: personId, projectId } });
  revalidateCasting(projectId);
  return { success: "Кандидат удалён" };
}
