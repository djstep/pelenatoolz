"use server";

import { revalidatePath } from "next/cache";
import {
  isCallSheetEditRefused,
  parseExpectedRevision,
  REVISION_FIELD,
} from "@/features/call-sheets/lib/revision";
import { withCallSheetRevision } from "@/features/call-sheets/revision-db";
import {
  saveResourceCallsSchema,
  saveResourceUsagesSchema,
  updateCallSheetHeaderSchema,
} from "@/features/day-docs/schemas";
import {
  computeActorTimingProposals,
  computeResourceTimingProposals,
  type ActorTimingProposal,
  type ResourceTimingProposal,
} from "@/features/day-docs/lib/compute-call-timings";
import { checkActorCallsSave } from "@/features/day-docs/lib/actor-call-rules";
import { checkTimeSlotsSave } from "@/features/day-docs/lib/plan-rules";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type CallSheetActionState = {
  error?: string;
  success?: string;
  /** Номер правки вызывного после сохранения (null — вызывной ещё не создан). */
  revision?: number | null;
};

function revalidateCallSheet(projectId: string, dayId: string) {
  revalidatePath(`/ru/projects/${projectId}/call-sheets/${dayId}`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
}

/** Отказ по номеру правки или утверждённому вызывному — текстом; остальное — дальше. */
function refusedState(error: unknown): CallSheetActionState {
  if (isCallSheetEditRefused(error)) return { error: error.message };
  throw error;
}

/** Все id — этого проекта (assertInProject без исключения). */
async function isInProject(
  entity: Parameters<typeof assertInProject>[0],
  ids: string[],
  projectId: string,
): Promise<boolean> {
  try {
    await assertInProject(entity, ids, projectId);
    return true;
  } catch (error) {
    if (isNotInProjectError(error)) return false;
    throw error;
  }
}

function emptyToNull(v: string | undefined | null) {
  const t = v?.trim();
  return t ? t : null;
}

async function auditCallSheet(
  ctx: { user: { id: string } },
  projectId: string,
  shootDayId: string,
  summary: string,
) {
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.callSheet,
    entityId: shootDayId,
    action: "UPDATE",
    summary,
  });
}

async function assertCallSheetWrite(projectId: string, shootDayId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("callsheet:write") && !ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" } as const;
  }
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    select: { id: true },
  });
  if (!day) return { error: "Съёмочный день не найден" } as const;
  return { ctx, dayId: day.id } as const;
}

export async function updateCallSheetHeaderAction(
  projectId: string,
  shootDayId: string,
  _prev: CallSheetActionState,
  formData: FormData,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const parsed = updateCallSheetHeaderSchema.safeParse({
    shiftNumber: formData.get("shiftNumber") || undefined,
    callTime: formData.get("callTime") || undefined,
    wrapTime: formData.get("wrapTime") || undefined,
    shiftStartTime: formData.get("shiftStartTime") || undefined,
    rehearsalTime: formData.get("rehearsalTime") || undefined,
    motorOnTime: formData.get("motorOnTime") || undefined,
    motorOffTime: formData.get("motorOffTime") || undefined,
    crewMeetAddress: formData.get("crewMeetAddress") || undefined,
    crewMeetTime: formData.get("crewMeetTime") || undefined,
    weatherNote: formData.get("weatherNote") || undefined,
    weatherPrecip: formData.get("weatherPrecip") || undefined,
    notes: formData.get("notes") || undefined,
    comment: formData.get("comment") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const d = parsed.data;
  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(formData.get(REVISION_FIELD)),
      (tx) =>
        tx.shootDay.update({
          where: { id: shootDayId },
          data: {
            shiftNumber: d.shiftNumber ?? null,
            callTime: emptyToNull(d.callTime),
            wrapTime: emptyToNull(d.wrapTime),
            shiftStartTime: emptyToNull(d.shiftStartTime),
            rehearsalTime: emptyToNull(d.rehearsalTime),
            motorOnTime: emptyToNull(d.motorOnTime),
            motorOffTime: emptyToNull(d.motorOffTime),
            crewMeetAddress: emptyToNull(d.crewMeetAddress),
            crewMeetTime: emptyToNull(d.crewMeetTime),
            weatherNote: emptyToNull(d.weatherNote),
            weatherPrecip: emptyToNull(d.weatherPrecip),
            notes: emptyToNull(d.notes),
            comment: emptyToNull(d.comment),
          },
        }),
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(gate.ctx, projectId, shootDayId, "Обновлён вызывной (шапка)");

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Шапка сохранена", revision: saved.revision };
}

export async function saveTimeSlotsAction(
  projectId: string,
  shootDayId: string,
  _prev: CallSheetActionState,
  formData: FormData,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  // Проверки — чистая функция plan-rules.ts: формат, «продолжение» только со сценой,
  // сцены этого проекта, вырезанную сцену в план не поставить. До первой записи.
  const checked = await checkTimeSlotsSave(
    {
      inProject: async (sceneIds) => {
        try {
          await assertInProject("Scene", sceneIds, projectId);
          return true;
        } catch (error) {
          if (isNotInProjectError(error)) return false;
          throw error;
        }
      },
      loadScenes: (sceneIds) =>
        prisma.scene.findMany({
          where: { id: { in: sceneIds }, projectId },
          select: { id: true, number: true, postfix: true, episodeNumber: true, cutAt: true },
        }),
    },
    String(formData.get("rows") ?? "[]"),
  );
  if ("error" in checked) return { error: checked.error };
  const expected = parseExpectedRevision(formData.get(REVISION_FIELD));

  let saved;
  try {
    saved = await auditMutation(
      gate.ctx,
      (rows: typeof checked.rows) =>
        withCallSheetRevision(projectId, shootDayId, expected, async (tx) => {
          await tx.shootDayTimeSlot.deleteMany({ where: { shootDayId } });
          for (const row of rows) {
            await tx.shootDayTimeSlot.create({ data: { shootDayId, ...row } });
          }
          await tx.shootDay.update({
            where: { id: shootDayId },
            data: { callSheetSavedAt: new Date() },
          });
        }),
      checked.rows,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        entityId: shootDayId,
        action: "UPDATE",
        summary: "Сохранено расписание дня",
        changes: (rows) => ({
          rows: rows.length,
          secondUnit: rows.filter((row) => row.unit === "SECOND").length,
          continuations: rows.filter((row) => row.isContinuation).length,
        }),
      },
    );
  } catch (error) {
    return refusedState(error);
  }

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Расписание сохранено", revision: saved.revision };
}

export async function saveActorCallsAction(
  projectId: string,
  shootDayId: string,
  _prev: CallSheetActionState,
  formData: FormData,
): Promise<CallSheetActionState> {
  const ctx = await requireProjectContext(projectId);
  // Проверки — чистая функция actor-call-rules.ts: право, день и актёры проекта, формат;
  // подача машины — только при «машина». До первой записи.
  const checked = await checkActorCallsSave(
    {
      canEdit: ctx.can("callsheet:write") || ctx.can("schedule:write"),
      dayInProject: (dayId) => isInProject("ShootDay", [dayId], projectId),
      actorsInProject: (actorIds) => isInProject("Actor", actorIds, projectId),
    },
    shootDayId,
    String(formData.get("rows") ?? "[]"),
  );
  if ("error" in checked) return { error: checked.error };
  const withData = checked.rows;
  const expected = parseExpectedRevision(formData.get(REVISION_FIELD));

  let saved;
  try {
    saved = await auditMutation(
      ctx,
      (data: typeof withData) =>
        withCallSheetRevision(projectId, shootDayId, expected, async (tx) => {
          await tx.shootDayActorCall.deleteMany({ where: { shootDayId } });
          for (const row of data) {
            await tx.shootDayActorCall.create({ data: { shootDayId, ...row } });
          }
        }),
      withData,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        entityId: shootDayId,
        action: "UPDATE",
        summary: "Сохранены тайминги актёров",
        changes: (data) => ({
          rows: data.length,
          transport: data.filter((row) => row.transportMode).length,
          carPickup: data.filter((row) => row.carPickupTime).length,
        }),
      },
    );
  } catch (error) {
    return refusedState(error);
  }

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Тайминги актёров сохранены", revision: saved.revision };
}

export async function saveResourceCallsAction(
  projectId: string,
  shootDayId: string,
  _prev: CallSheetActionState,
  formData: FormData,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  let rows: unknown[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Некорректный формат" };
  }

  const parsed = saveResourceCallsSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте ресурсы" };
  }

  const withData = parsed.data.rows.filter(
    (r) =>
      r.arrivalTime ||
      r.costumeTime ||
      r.makeupTime ||
      r.readyTime ||
      r.wrapTime,
  );

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(formData.get(REVISION_FIELD)),
      async (tx) => {
        await tx.shootDayResourceCall.deleteMany({ where: { shootDayId } });
        for (const row of withData) {
          await tx.shootDayResourceCall.create({
            data: {
              shootDayId,
              category: row.category,
              name: row.name,
              arrivalTime: emptyToNull(row.arrivalTime),
              costumeTime: emptyToNull(row.costumeTime),
              makeupTime: emptyToNull(row.makeupTime),
              readyTime: emptyToNull(row.readyTime),
              wrapTime: emptyToNull(row.wrapTime),
            },
          });
        }
      },
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(gate.ctx, projectId, shootDayId, "Сохранены тайминги ресурсов");

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Тайминги ресурсов сохранены", revision: saved.revision };
}

export async function saveResourceUsagesAction(
  projectId: string,
  shootDayId: string,
  _prev: CallSheetActionState,
  formData: FormData,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  let rows: unknown[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Некорректный формат" };
  }

  const parsed = saveResourceUsagesSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте посменные ресурсы" };
  }

  const itemIds = [...new Set(parsed.data.rows.map((row) => row.itemId))];
  try {
    await assertInProject("ResourceItem", itemIds, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(formData.get(REVISION_FIELD)),
      async (tx) => {
        for (const row of parsed.data.rows) {
          await tx.shootDayResourceUsage.updateMany({
            where: {
              shootDayId,
              itemId: row.itemId,
              item: { category: { projectId, perShift: true } },
            },
            data: {
              arrivalTime: emptyToNull(row.arrivalTime),
              readyTime: emptyToNull(row.readyTime),
              wrapTime: emptyToNull(row.wrapTime),
            },
          });
        }
      },
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(gate.ctx, projectId, shootDayId, "Сохранены посменные ресурсы");

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Посменные ресурсы сохранены", revision: saved.revision };
}

export async function addPerShiftResourceAction(
  projectId: string,
  shootDayId: string,
  itemId: string,
  revision: unknown,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const item = await prisma.resourceItem.findFirst({
    where: { id: itemId, category: { projectId, perShift: true } },
    select: { id: true, name: true, category: { select: { name: true } } },
  });
  if (!item) return { error: "Ресурс не найден или категория не посменная" };

  const existing = await prisma.shootDayResourceUsage.findUnique({
    where: { shootDayId_itemId: { shootDayId, itemId } },
  });
  if (existing) return { success: "Ресурс уже в списке" };

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(revision),
      (tx) =>
        tx.shootDayResourceUsage.create({
          data: { shootDayId, itemId, isUsed: true },
        }),
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(
    gate.ctx,
    projectId,
    shootDayId,
    `Добавлен посменный ресурс «${item.name}»`,
  );
  revalidateCallSheet(projectId, shootDayId);
  return { success: "Ресурс добавлен", revision: saved.revision };
}

export async function removePerShiftResourceAction(
  projectId: string,
  shootDayId: string,
  itemId: string,
  revision: unknown,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(revision),
      (tx) =>
        tx.shootDayResourceUsage.deleteMany({
          where: {
            shootDayId,
            itemId,
            item: { category: { projectId, perShift: true } },
          },
        }),
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(gate.ctx, projectId, shootDayId, "Удалён посменный ресурс");
  revalidateCallSheet(projectId, shootDayId);
  return { success: "Ресурс убран из дня", revision: saved.revision };
}

export async function toggleCallSheetPlanLockAction(
  projectId: string,
  shootDayId: string,
  locked: boolean,
  revision: unknown,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(revision),
      (tx) =>
        tx.shootDay.update({
          where: { id: shootDayId },
          data: { callSheetPlanLocked: locked },
        }),
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(
    gate.ctx,
    projectId,
    shootDayId,
    locked ? "План вызывного зафиксирован" : "План вызывного разблокирован",
  );

  revalidateCallSheet(projectId, shootDayId);
  return {
    success: locked ? "План зафиксирован" : "План разблокирован",
    revision: saved.revision,
  };
}

export async function previewRecalculateActorTimingsAction(
  projectId: string,
  shootDayId: string,
): Promise<{ proposals: ActorTimingProposal[] } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("callsheet:write") && !ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" };
  }

  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: {
      timeSlots: {
        orderBy: { sortOrder: "asc" },
        include: { scene: { select: { cutAt: true } } },
      },
      // Вырезанные сцены в пересчёт не идут.
      scenes: {
        where: { scene: { cutAt: null } },
        include: {
          scene: {
            select: {
              id: true,
              characters: { select: { characterId: true } },
            },
          },
        },
      },
      actorCalls: true,
    },
  });
  if (!day) return { error: "Съёмочный день не найден" };
  if (day.timeSlots.length === 0) {
    return { error: "Сначала примените план дня к расписанию" };
  }

  const characterIds = new Set<string>();
  const sceneCharacters: Array<{ sceneId: string; characterId: string }> = [];
  for (const row of day.scenes) {
    for (const link of row.scene.characters) {
      characterIds.add(link.characterId);
      sceneCharacters.push({
        sceneId: row.scene.id,
        characterId: link.characterId,
      });
    }
  }

  const [actors, characters] = await Promise.all([
    prisma.actor.findMany({
      where: { projectId, characterId: { in: [...characterIds] } },
      select: {
        id: true,
        characterId: true,
        pickupOffsetMin: true,
        lastName: true,
        firstName: true,
        middleName: true,
      },
    }),
    prisma.character.findMany({
      where: { id: { in: [...characterIds] } },
      select: {
        id: true,
        makeupOffsetMin: true,
        costumeOffsetMin: true,
      },
    }),
  ]);

  const proposals = computeActorTimingProposals({
    timeSlots: day.timeSlots,
    sceneCharacters,
    actors: actors.map((a) => ({
      id: a.id,
      characterId: a.characterId,
      pickupOffsetMin: a.pickupOffsetMin,
      label: [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" "),
    })),
    characters,
    currentCalls: day.actorCalls,
  });

  return { proposals };
}

export async function applyRecalculateActorTimingsAction(
  projectId: string,
  shootDayId: string,
  actorIds: string[],
  revision: unknown,
): Promise<CallSheetActionState> {
  const preview = await previewRecalculateActorTimingsAction(projectId, shootDayId);
  if ("error" in preview) return { error: preview.error };

  const selected = new Set(actorIds);
  const toApply = preview.proposals.filter((p) => selected.has(p.actorId));
  if (toApply.length === 0) {
    return { error: "Нет изменений для применения" };
  }

  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  try {
    await assertInProject("Actor", actorIds, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(revision),
      async (tx) => {
        for (const proposal of toApply) {
          const existing = await tx.shootDayActorCall.findUnique({
            where: { shootDayId_actorId: { shootDayId, actorId: proposal.actorId } },
          });

          const patch = {
            pickupTime: proposal.fields.pickupTime?.proposed ?? existing?.pickupTime ?? null,
            makeupTime: proposal.fields.makeupTime?.proposed ?? existing?.makeupTime ?? null,
            costumeTime:
              proposal.fields.costumeTime?.proposed ?? existing?.costumeTime ?? null,
            readyTime: proposal.fields.readyTime?.proposed ?? existing?.readyTime ?? null,
            wrapTime: proposal.fields.wrapTime?.proposed ?? existing?.wrapTime ?? null,
          };

          const hasData = Object.values(patch).some(Boolean);
          if (!hasData) continue;

          await tx.shootDayActorCall.upsert({
            where: { shootDayId_actorId: { shootDayId, actorId: proposal.actorId } },
            create: { shootDayId, actorId: proposal.actorId, ...patch },
            update: patch,
          });
        }

        await tx.shootDay.update({
          where: { id: shootDayId },
          data: { callSheetSavedAt: new Date() },
        });
      },
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(
    gate.ctx,
    projectId,
    shootDayId,
    `Пересчитаны тайминги актёров (${toApply.length})`,
  );

  revalidateCallSheet(projectId, shootDayId);
  return { success: `Обновлено таймингов: ${toApply.length}`, revision: saved.revision };
}

export async function previewRecalculateResourceTimingsAction(
  projectId: string,
  shootDayId: string,
): Promise<{ proposals: ResourceTimingProposal[] } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("callsheet:write") && !ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" };
  }

  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: {
      timeSlots: {
        orderBy: { sortOrder: "asc" },
        include: { scene: { select: { cutAt: true } } },
      },
      // Вырезанные сцены в пересчёт не идут.
      scenes: {
        where: { scene: { cutAt: null } },
        include: {
          scene: {
            select: {
              id: true,
              resources: { select: { category: true, name: true } },
              elements: {
                select: {
                  element: { select: { name: true, type: true } },
                },
              },
              resourceItems: {
                select: {
                  quantity: true,
                  item: {
                    select: {
                      name: true,
                      arrivalOffsetMin: true,
                      category: { select: { name: true, perShift: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      resourceCalls: true,
      resourceUsages: {
        where: { item: { category: { perShift: true } } },
        include: {
          item: {
            select: {
              name: true,
              arrivalOffsetMin: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!day) return { error: "Съёмочный день не найден" };
  if (day.timeSlots.length === 0) {
    return { error: "Сначала примените план дня к расписанию" };
  }

  const perShiftUsages = day.resourceUsages.map((u) => ({
    key: `${u.item.category.name}::${u.item.name}`,
    arrivalOffsetMin: u.item.arrivalOffsetMin,
  }));

  const proposals = computeResourceTimingProposals({
    timeSlots: day.timeSlots,
    dayScenes: day.scenes,
    shiftStartTime: day.shiftStartTime,
    callTime: day.callTime,
    perShiftUsages,
    currentCalls: day.resourceCalls,
    currentPerShiftUsages: day.resourceUsages.map((u) => ({
      key: `${u.item.category.name}::${u.item.name}`,
      arrivalTime: u.arrivalTime,
      readyTime: u.readyTime,
      wrapTime: u.wrapTime,
    })),
  });

  return { proposals };
}

export async function applyRecalculateResourceTimingsAction(
  projectId: string,
  shootDayId: string,
  resourceKeys: string[],
  revision: unknown,
): Promise<CallSheetActionState> {
  const preview = await previewRecalculateResourceTimingsAction(
    projectId,
    shootDayId,
  );
  if ("error" in preview) return { error: preview.error };

  const selected = new Set(resourceKeys);
  const toApply = preview.proposals.filter((p) => selected.has(p.key));
  if (toApply.length === 0) {
    return { error: "Нет изменений для применения" };
  }

  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  let saved;
  try {
    saved = await withCallSheetRevision(
      projectId,
      shootDayId,
      parseExpectedRevision(revision),
      async (tx) => {
        for (const proposal of toApply) {
          const [category, ...nameParts] = proposal.key.split("::");
          const name = nameParts.join("::");
          if (!category || !name) continue;

          const perShiftUsage = await tx.shootDayResourceUsage.findFirst({
            where: {
              shootDayId,
              item: { name, category: { name: category, projectId, perShift: true } },
            },
          });

          if (perShiftUsage) {
            const patch = {
              arrivalTime:
                proposal.fields.arrivalTime?.proposed ?? perShiftUsage.arrivalTime ?? null,
              readyTime:
                proposal.fields.readyTime?.proposed ?? perShiftUsage.readyTime ?? null,
              wrapTime:
                proposal.fields.wrapTime?.proposed ?? perShiftUsage.wrapTime ?? null,
            };
            if (Object.values(patch).some(Boolean)) {
              await tx.shootDayResourceUsage.update({
                where: { id: perShiftUsage.id },
                data: patch,
              });
            }
            continue;
          }

          const existing = await tx.shootDayResourceCall.findUnique({
            where: {
              shootDayId_category_name: {
                shootDayId,
                category,
                name,
              },
            },
          });

          const patch = {
            arrivalTime:
              proposal.fields.arrivalTime?.proposed ?? existing?.arrivalTime ?? null,
            readyTime: proposal.fields.readyTime?.proposed ?? existing?.readyTime ?? null,
            wrapTime: proposal.fields.wrapTime?.proposed ?? existing?.wrapTime ?? null,
          };

          const hasData = Object.values(patch).some(Boolean);
          if (!hasData) continue;

          await tx.shootDayResourceCall.upsert({
            where: {
              shootDayId_category_name: { shootDayId, category, name },
            },
            create: { shootDayId, category, name, ...patch },
            update: patch,
          });
        }

        await tx.shootDay.update({
          where: { id: shootDayId },
          data: { callSheetSavedAt: new Date() },
        });
      },
    );
  } catch (error) {
    return refusedState(error);
  }

  await auditCallSheet(
    gate.ctx,
    projectId,
    shootDayId,
    `Пересчитаны тайминги ресурсов (${toApply.length})`,
  );

  revalidateCallSheet(projectId, shootDayId);
  return { success: `Обновлено ресурсов: ${toApply.length}`, revision: saved.revision };
}

export async function exportAttendanceSheetXlsxAction(
  projectId: string,
  dayId: string,
): Promise<{ base64: string; fileName: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (
    !ctx.can("callsheet:read") &&
    !ctx.can("schedule:read") &&
    !ctx.can("report:read")
  ) {
    return { error: "Недостаточно прав" };
  }

  const { getShootDayDocument } = await import("@/features/day-docs/queries");
  const { listResourceCategories } = await import(
    "@/features/resources/queries"
  );
  const { parseExportSettings } = await import(
    "@/features/exports/lib/column-utils"
  );
  const { buildAttendanceSheetModel } = await import(
    "@/features/day-docs/lib/export-attendance-sheet"
  );
  const { buildAttendanceSheetXlsx } = await import(
    "@/features/day-docs/lib/export-attendance-sheet-xlsx"
  );
  const { prisma } = await import("@/shared/db/prisma");

  const { getCallSheetForDay } = await import("@/features/call-sheets/queries");

  const [bundle, categories, project, callSheet] = await Promise.all([
    getShootDayDocument(projectId, dayId),
    listResourceCategories(projectId),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { exportSettings: true },
    }),
    // Тот же день и проект, что у `getShootDayDocument`: чужой день — null.
    getCallSheetForDay(projectId, dayId),
  ]);
  if (!bundle) return { error: "Съёмочный день не найден" };
  if (!project) return { error: "Проект не найден" };

  const settings = parseExportSettings(project.exportSettings);
  const model = buildAttendanceSheetModel(
    bundle,
    settings.attendanceSheet ?? { resourceIds: [] },
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      perShift: c.perShift,
    })),
    callSheet,
  );

  const buffer = await buildAttendanceSheetXlsx(model);
  return {
    base64: Buffer.from(buffer).toString("base64"),
    fileName: `${model.fileBaseName}.xlsx`,
  };
}
