"use server";

import { revalidatePath } from "next/cache";
import {
  saveActorCallsSchema,
  saveDepartmentCallsSchema,
  saveResourceCallsSchema,
  saveTimeSlotsSchema,
  saveTransportsSchema,
  updateCallSheetHeaderSchema,
} from "@/features/day-docs/schemas";
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
