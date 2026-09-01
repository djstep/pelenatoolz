"use server";

import { revalidatePath } from "next/cache";
import {
  saveActorCallsSchema,
  saveDepartmentCallsSchema,
  saveResourceCallsSchema,
  saveResourceUsagesSchema,
  saveTimeSlotsSchema,
  saveTransportsSchema,
  updateCallSheetHeaderSchema,
} from "@/features/day-docs/schemas";
import {
  computeActorTimingProposals,
  computeResourceTimingProposals,
  type ActorTimingProposal,
  type ResourceTimingProposal,
} from "@/features/day-docs/lib/compute-call-timings";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";

export type CallSheetActionState = { error?: string; success?: string };

function revalidateCallSheet(projectId: string, dayId: string) {
  revalidatePath(`/ru/projects/${projectId}/call-sheets/${dayId}`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
}

function emptyToNull(v: string | undefined | null) {
  const t = v?.trim();
  return t ? t : null;
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
  await prisma.shootDay.update({
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
  });

  await writeAuditLog({
    projectId,
    userId: gate.ctx.user.id!,
    entityType: "ShootDay",
    entityId: shootDayId,
    action: "UPDATE",
    summary: "Обновлён вызывной (шапка)",
  });

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Шапка сохранена" };
}

export async function saveDepartmentCallsAction(
  projectId: string,
  shootDayId: string,
  _prev: CallSheetActionState,
  formData: FormData,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const raw = formData.get("rows");
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { error: "Некорректный формат списка" };
  }

  const parsed = saveDepartmentCallsSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте контакты" };
  }

  await prisma.$transaction([
    prisma.departmentCallTime.deleteMany({ where: { shootDayId } }),
    ...parsed.data.rows.map((row, index) =>
      prisma.departmentCallTime.create({
        data: {
          shootDayId,
          roleLabel: row.roleLabel,
          personName: emptyToNull(row.personName),
          phone: emptyToNull(row.phone),
          callTime: emptyToNull(row.callTime),
          sortOrder: index,
        },
      }),
    ),
  ]);

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Контакты сохранены" };
}

export async function saveTransportsAction(
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
    return { error: "Некорректный формат списка" };
  }

  const parsed = saveTransportsSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте транспорт" };
  }

  await prisma.$transaction([
    prisma.shootDayTransport.deleteMany({ where: { shootDayId } }),
    ...parsed.data.rows.map((row, index) =>
      prisma.shootDayTransport.create({
        data: {
          shootDayId,
          name: row.name,
          callTime: emptyToNull(row.callTime),
          notes: emptyToNull(row.notes),
          sortOrder: index,
        },
      }),
    ),
  ]);

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Спецтранспорт сохранён" };
}

export async function saveTimeSlotsAction(
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
    return { error: "Некорректный формат расписания" };
  }

  const parsed = saveTimeSlotsSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте слоты" };
  }

  await prisma.$transaction([
    prisma.shootDayTimeSlot.deleteMany({ where: { shootDayId } }),
    ...parsed.data.rows.map((row, index) =>
      prisma.shootDayTimeSlot.create({
        data: {
          shootDayId,
          startTime: row.startTime,
          endTime: emptyToNull(row.endTime),
          slotType: row.slotType,
          sceneId: row.sceneId || null,
          notes: emptyToNull(row.notes),
          sortOrder: index,
        },
      }),
    ),
    prisma.shootDay.update({
      where: { id: shootDayId },
      data: { callSheetSavedAt: new Date() },
    }),
  ]);

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Расписание сохранено" };
}

export async function saveActorCallsAction(
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

  const parsed = saveActorCallsSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте тайминги актёров" };
  }

  const withData = parsed.data.rows.filter(
    (r) =>
      r.pickupTime ||
      r.arrivalTime ||
      r.makeupTime ||
      r.costumeTime ||
      r.readyTime ||
      r.wrapTime,
  );

  await prisma.$transaction([
    prisma.shootDayActorCall.deleteMany({ where: { shootDayId } }),
    ...withData.map((row) =>
      prisma.shootDayActorCall.create({
        data: {
          shootDayId,
          actorId: row.actorId,
          pickupTime: emptyToNull(row.pickupTime),
          arrivalTime: emptyToNull(row.arrivalTime),
          makeupTime: emptyToNull(row.makeupTime),
          costumeTime: emptyToNull(row.costumeTime),
          readyTime: emptyToNull(row.readyTime),
          wrapTime: emptyToNull(row.wrapTime),
        },
      }),
    ),
  ]);

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Тайминги актёров сохранены" };
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

  await prisma.$transaction([
    prisma.shootDayResourceCall.deleteMany({ where: { shootDayId } }),
    ...withData.map((row) =>
      prisma.shootDayResourceCall.create({
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
      }),
    ),
  ]);

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Тайминги ресурсов сохранены" };
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

  await prisma.$transaction(
    parsed.data.rows.map((row) =>
      prisma.shootDayResourceUsage.upsert({
        where: { shootDayId_itemId: { shootDayId, itemId: row.itemId } },
        create: {
          shootDayId,
          itemId: row.itemId,
          isUsed: row.isUsed,
          arrivalTime: emptyToNull(row.arrivalTime),
        },
        update: {
          isUsed: row.isUsed,
          arrivalTime: emptyToNull(row.arrivalTime),
        },
      }),
    ),
  );

  revalidateCallSheet(projectId, shootDayId);
  return { success: "Посменные ресурсы сохранены" };
}

export async function toggleCallSheetPlanLockAction(
  projectId: string,
  shootDayId: string,
  locked: boolean,
): Promise<CallSheetActionState> {
  const gate = await assertCallSheetWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  await prisma.shootDay.update({
    where: { id: shootDayId },
    data: { callSheetPlanLocked: locked },
  });

  revalidateCallSheet(projectId, shootDayId);
  return { success: locked ? "План зафиксирован" : "План разблокирован" };
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
      timeSlots: { orderBy: { sortOrder: "asc" } },
      scenes: {
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

  for (const proposal of toApply) {
    const existing = await prisma.shootDayActorCall.findUnique({
      where: { shootDayId_actorId: { shootDayId, actorId: proposal.actorId } },
    });

    const patch = {
      pickupTime: proposal.fields.pickupTime?.proposed ?? existing?.pickupTime ?? null,
      makeupTime: proposal.fields.makeupTime?.proposed ?? existing?.makeupTime ?? null,
      costumeTime: proposal.fields.costumeTime?.proposed ?? existing?.costumeTime ?? null,
      readyTime: proposal.fields.readyTime?.proposed ?? existing?.readyTime ?? null,
      wrapTime: proposal.fields.wrapTime?.proposed ?? existing?.wrapTime ?? null,
    };

    const hasData = Object.values(patch).some(Boolean);
    if (!hasData) continue;

    await prisma.shootDayActorCall.upsert({
      where: { shootDayId_actorId: { shootDayId, actorId: proposal.actorId } },
      create: { shootDayId, actorId: proposal.actorId, ...patch },
      update: patch,
    });
  }

  await prisma.shootDay.update({
    where: { id: shootDayId },
    data: { callSheetSavedAt: new Date() },
  });

  revalidateCallSheet(projectId, shootDayId);
  return { success: `Обновлено таймингов: ${toApply.length}` };
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
      timeSlots: { orderBy: { sortOrder: "asc" } },
      scenes: {
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
    },
  });
  if (!day) return { error: "Съёмочный день не найден" };
  if (day.timeSlots.length === 0) {
    return { error: "Сначала примените план дня к расписанию" };
  }

  const proposals = computeResourceTimingProposals({
    timeSlots: day.timeSlots,
    dayScenes: day.scenes,
    shiftStartTime: day.shiftStartTime,
    callTime: day.callTime,
    currentCalls: day.resourceCalls,
  });

  return { proposals };
}

export async function applyRecalculateResourceTimingsAction(
  projectId: string,
  shootDayId: string,
  resourceKeys: string[],
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

  for (const proposal of toApply) {
    const [category, ...nameParts] = proposal.key.split("::");
    const name = nameParts.join("::");
    if (!category || !name) continue;

    const existing = await prisma.shootDayResourceCall.findUnique({
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
      costumeTime:
        proposal.fields.costumeTime?.proposed ?? existing?.costumeTime ?? null,
      makeupTime:
        proposal.fields.makeupTime?.proposed ?? existing?.makeupTime ?? null,
      readyTime: proposal.fields.readyTime?.proposed ?? existing?.readyTime ?? null,
      wrapTime: proposal.fields.wrapTime?.proposed ?? existing?.wrapTime ?? null,
    };

    const hasData = Object.values(patch).some(Boolean);
    if (!hasData) continue;

    await prisma.shootDayResourceCall.upsert({
      where: {
        shootDayId_category_name: { shootDayId, category, name },
      },
      create: { shootDayId, category, name, ...patch },
      update: patch,
    });
  }

  await prisma.shootDay.update({
    where: { id: shootDayId },
    data: { callSheetSavedAt: new Date() },
  });

  revalidateCallSheet(projectId, shootDayId);
  return { success: `Обновлено ресурсов: ${toApply.length}` };
}

async function loadCallSheetExportBundle(projectId: string, dayId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("callsheet:read") && !ctx.can("schedule:read")) {
    return { error: "Недостаточно прав" } as const;
  }

  const { getShootDayDocument, getNextShootDayBrief } = await import(
    "@/features/day-docs/queries"
  );
  const { fetchCityAstro } = await import("@/features/day-docs/lib/city-astro");
  const { buildCallSheetExportModel } = await import(
    "@/features/day-docs/lib/export-call-sheet"
  );

  const bundle = await getShootDayDocument(projectId, dayId);
  if (!bundle) return { error: "Съёмочный день не найден" } as const;

  const [astro, nextDay] = await Promise.all([
    fetchCityAstro(
      bundle.project.city,
      bundle.day.date,
      bundle.project.timezone,
    ),
    getNextShootDayBrief(projectId, bundle.day.dayNumber),
  ]);

  const nextDayAstro = nextDay
    ? await fetchCityAstro(
        bundle.project.city,
        nextDay.date,
        bundle.project.timezone,
      )
    : null;

  const model = buildCallSheetExportModel(bundle, astro, nextDay, nextDayAstro);
  return { model } as const;
}

export async function exportCallSheetXlsxAction(
  projectId: string,
  dayId: string,
): Promise<{ base64: string; fileName: string } | { error: string }> {
  const loaded = await loadCallSheetExportBundle(projectId, dayId);
  if ("error" in loaded) return loaded;

  const { buildCallSheetXlsx } = await import(
    "@/features/day-docs/lib/export-call-sheet-xlsx"
  );
  const buffer = await buildCallSheetXlsx(loaded.model);
  return {
    base64: Buffer.from(buffer).toString("base64"),
    fileName: `${loaded.model.fileBaseName}.xlsx`,
  };
}

export async function exportCallSheetPdfAction(
  projectId: string,
  dayId: string,
): Promise<{ base64: string; fileName: string } | { error: string }> {
  const loaded = await loadCallSheetExportBundle(projectId, dayId);
  if ("error" in loaded) return loaded;

  const { buildCallSheetPdf } = await import(
    "@/features/day-docs/lib/export-call-sheet-pdf"
  );
  const buffer = await buildCallSheetPdf(loaded.model);
  return {
    base64: buffer.toString("base64"),
    fileName: `${loaded.model.fileBaseName}.pdf`,
  };
}

export async function exportCallSheetPrintHtmlAction(
  projectId: string,
  dayId: string,
): Promise<{ html: string; fileName: string } | { error: string }> {
  const loaded = await loadCallSheetExportBundle(projectId, dayId);
  if ("error" in loaded) return loaded;

  const { buildCallSheetPrintHtml } = await import(
    "@/features/day-docs/lib/export-call-sheet"
  );
  return {
    html: buildCallSheetPrintHtml(loaded.model),
    fileName: `${loaded.model.fileBaseName}.html`,
  };
}
