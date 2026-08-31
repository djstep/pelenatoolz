"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CharacterCastSnapshot } from "@/features/preproduction/lib/snapshots";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export type CharacterActionState = { error?: string; success?: string };

const requirementsSchema = z.object({
  description: z.string().trim().max(5000).optional(),
  roleRequirements: z.string().trim().max(5000).optional(),
});

const snapshotSchema = z.object({
  riderNotes: z.string().trim().max(10000).optional(),
  shiftRate: z.coerce.number().min(0).optional(),
  proposedTerms: z.string().trim().max(5000).optional(),
  skills: z.string().trim().optional(),
});

const characterRecordSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  roleRequirements: z.string().trim().max(5000).optional(),
});

function revalidateCharacters(projectId: string, characterId?: string) {
  revalidatePath(`/ru/projects/${projectId}/characters`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
  if (characterId) {
    revalidatePath(`/ru/projects/${projectId}/characters/${characterId}`);
  }
}

function revalidateCharacter(projectId: string, characterId: string) {
  revalidateCharacters(projectId, characterId);
}

export async function updateCharacterRequirementsAction(
  projectId: string,
  characterId: string,
  _prev: CharacterActionState,
  formData: FormData,
): Promise<CharacterActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = requirementsSchema.safeParse({
    description: formData.get("description") || undefined,
    roleRequirements: formData.get("roleRequirements") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  await prisma.character.updateMany({
    where: { id: characterId, projectId },
    data: parsed.data,
  });

  revalidateCharacter(projectId, characterId);
  return { success: "Сохранено" };
}

export async function updateCharacterCastSnapshotAction(
  projectId: string,
  characterId: string,
  _prev: CharacterActionState,
  formData: FormData,
): Promise<CharacterActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const character = await prisma.character.findFirst({
    where: { id: characterId, projectId },
  });
  if (!character) return { error: "Персонаж не найден" };
  if (!character.castSnapshot) {
    return { error: "Снимок каста появится после утверждения кандидата" };
  }

  const parsed = snapshotSchema.safeParse({
    riderNotes: formData.get("riderNotes") || undefined,
    shiftRate: formData.get("shiftRate") || undefined,
    proposedTerms: formData.get("proposedTerms") || undefined,
    skills: formData.get("skills") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  const current = character.castSnapshot as CharacterCastSnapshot;
  const skills = parsed.data.skills
    ? parsed.data.skills.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    : current.skills;

  const next: CharacterCastSnapshot = {
    ...current,
    riderNotes: parsed.data.riderNotes ?? current.riderNotes,
    shiftRate: parsed.data.shiftRate ?? current.shiftRate,
    proposedTerms: parsed.data.proposedTerms ?? current.proposedTerms,
    skills,
  };

  await prisma.character.update({
    where: { id: characterId },
    data: { castSnapshot: next },
  });

  const actor = await prisma.actor.findFirst({
    where: { projectId, characterId },
  });
  if (actor && parsed.data.shiftRate != null) {
    await prisma.actor.update({
      where: { id: actor.id },
      data: {
        shiftRate: parsed.data.shiftRate,
        specialConditions: next.proposedTerms ?? actor.specialConditions,
      },
    });
  }

  revalidateCharacter(projectId, characterId);
  return { success: "Данные утверждённого актёра обновлены" };
}

export async function createCharacterRecordAction(
  projectId: string,
  _prev: CharacterActionState,
  formData: FormData,
): Promise<CharacterActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = characterRecordSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    roleRequirements: formData.get("roleRequirements") || undefined,
  });
  if (!parsed.success) return { error: "Укажите имя персонажа" };

  await prisma.character.create({
    data: { projectId, ...parsed.data },
  });

  revalidateCharacters(projectId);
  return { success: "Персонаж добавлен" };
}

export async function updateCharacterRecordAction(
  projectId: string,
  characterId: string,
  _prev: CharacterActionState,
  formData: FormData,
): Promise<CharacterActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = characterRecordSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    roleRequirements: formData.get("roleRequirements") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  const updated = await prisma.character.updateMany({
    where: { id: characterId, projectId },
    data: parsed.data,
  });
  if (updated.count === 0) return { error: "Персонаж не найден" };

  revalidateCharacters(projectId, characterId);
  return { success: "Персонаж сохранён" };
}

export async function deleteCharacterAction(projectId: string, characterId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) throw new Error("FORBIDDEN");

  const character = await prisma.character.findFirst({
    where: { id: characterId, projectId },
  });
  if (!character) throw new Error("NOT_FOUND");

  await prisma.$transaction([
    prisma.actor.updateMany({
      where: { projectId, characterId },
      data: { characterId: null },
    }),
    prisma.character.deleteMany({ where: { id: characterId, projectId } }),
  ]);

  revalidateCharacters(projectId);
}
