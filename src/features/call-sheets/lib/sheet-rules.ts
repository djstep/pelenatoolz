import { z } from "zod";
import { NO_RIGHTS, type InProjectCheck } from "@/features/call-sheets/lib/template-rules";
import { optionalPhoneSchema } from "@/shared/lib/phone";

/**
 * Правка самого вызывного: руководители, вызов цехов, база и транспорт (копии шаблона)
 * и поля листа (температура, «Важно», «Ограничения по актёрам», объект схемы).
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalTime = z
  .string()
  .trim()
  .refine((v) => v === "" || TIME_PATTERN.test(v), "Время — в виде ЧЧ:ММ")
  .transform((v) => (v === "" ? null : v));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не больше ${max} символов`)
    .transform((v) => (v === "" ? null : v));

const optionalId = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v === "" ? null : v));

export const MAX_SHEET_ROWS = 100;

const leaderSchema = z.object({
  /** id строки в вызывном; пусто — новая строка. */
  id: optionalId,
  position: z.string().trim().min(1, "Укажите должность руководителя").max(100),
  shortTitle: optionalText(40),
  membershipId: optionalId,
  personName: optionalText(200),
  phone: optionalPhoneSchema,
});

const crewCallSchema = z.object({
  departmentId: optionalId,
  label: optionalText(100),
  callTime: optionalTime,
});

const baseItemSchema = z.object({
  name: z.string().trim().min(1, "Укажите наименование в «Базе и транспорте»").max(200),
  callTime: optionalTime,
  notNeeded: z.boolean(),
});

export const callSheetSheetSchema = z
  .object({
    tempDay: optionalText(20),
    tempNight: optionalText(20),
    importantNote: optionalText(2000),
    actorRestrictions: optionalText(2000),
    schemeLocationId: optionalId,
    leaders: z.array(leaderSchema).max(MAX_SHEET_ROWS, "Слишком много строк"),
    crewCalls: z.array(crewCallSchema).max(MAX_SHEET_ROWS, "Слишком много строк"),
    baseItems: z.array(baseItemSchema).max(MAX_SHEET_ROWS, "Слишком много строк"),
  })
  .superRefine((data, ctx) => {
    const departments = data.crewCalls
      .map((row) => row.departmentId)
      .filter((id): id is string => id !== null);
    if (new Set(departments).size < departments.length) {
      ctx.addIssue({ code: "custom", message: "Один цех добавлен в вызов дважды" });
    }
    const ids = data.leaders.map((row) => row.id).filter((id): id is string => id !== null);
    if (new Set(ids).size < ids.length) {
      ctx.addIssue({ code: "custom", message: "Некорректные данные" });
    }
  });

export type CallSheetSheetData = z.infer<typeof callSheetSheetSchema>;

/** Разбор JSON формы вызывного. */
export function parseSheetPayload(
  raw: unknown,
): { data: CallSheetSheetData } | { error: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { error: "Некорректные данные" };
    }
  }
  const parsed = callSheetSheetSchema.safeParse(value);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Некорректные данные" };
  return { data: parsed.data };
}

export const MEMBER_LEFT = "Участник вышел из проекта или не найден — выберите другого";
export const SHEET_DEPARTMENT_NOT_FOUND = "Цех не найден";
export const SCHEME_LOCATION_NOT_FOUND = "Объект не найден";

/** Руководитель, как он сейчас лежит в вызывном. */
export type StoredLeader = {
  id: string;
  membershipId: string | null;
  personName: string | null;
  phone: string | null;
};

/**
 * Участники, которых надо проверить: новые строки и строки, где человека сменили.
 * Строка, где участник тот же, остаётся со своим снимком ФИ и телефона, даже если
 * участник потом вышел из проекта.
 */
export function changedMemberIds(
  leaders: CallSheetSheetData["leaders"],
  stored: readonly StoredLeader[],
): string[] {
  const storedById = new Map(stored.map((row) => [row.id, row]));
  const ids = leaders
    .filter((row) => row.membershipId !== null)
    .filter((row) => {
      const before = row.id ? storedById.get(row.id) : undefined;
      return !before || before.membershipId !== row.membershipId;
    })
    .map((row) => row.membershipId!);
  return [...new Set(ids)];
}

/**
 * Проверки сохранения вызывного до записи: право, данные, новые участники, цеха и объект
 * схемы — этого проекта.
 */
export async function checkSheetSave(
  deps: { canEdit: boolean; inProject: InProjectCheck },
  raw: unknown,
  stored: readonly StoredLeader[],
): Promise<{ data: CallSheetSheetData } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  const parsed = parseSheetPayload(raw);
  if ("error" in parsed) return parsed;
  const { data } = parsed;

  if (!(await deps.inProject("ProjectMembership", changedMemberIds(data.leaders, stored)))) {
    return { error: MEMBER_LEFT };
  }
  const departmentIds = data.crewCalls
    .map((row) => row.departmentId)
    .filter((id): id is string => id !== null);
  if (!(await deps.inProject("Department", departmentIds))) {
    return { error: SHEET_DEPARTMENT_NOT_FOUND };
  }
  if (data.schemeLocationId && !(await deps.inProject("Location", [data.schemeLocationId]))) {
    return { error: SCHEME_LOCATION_NOT_FOUND };
  }
  return { data };
}

export type SheetRows = {
  leaders: {
    position: string;
    shortTitle: string | null;
    membershipId: string | null;
    personName: string | null;
    phone: string | null;
    sortOrder: number;
  }[];
  crewCalls: { departmentId: string | null; label: string; callTime: string | null; sortOrder: number }[];
  baseItems: { name: string; callTime: string | null; notNeeded: boolean; sortOrder: number }[];
};

/**
 * Строки для записи. Руководитель-участник: тот же человек — прежний снимок ФИ и телефона,
 * новый человек — снимок из профиля сейчас (что прислал браузер, не берём). Свободное имя —
 * как ввели. Цех: пустое название — название цеха. Порядок — порядок в форме.
 */
export function buildSheetRows(
  data: CallSheetSheetData,
  stored: readonly StoredLeader[],
  profiles: ReadonlyMap<string, { name: string; phone: string | null }>,
  departmentNames: ReadonlyMap<string, string>,
): SheetRows {
  const storedById = new Map(stored.map((row) => [row.id, row]));
  return {
    leaders: data.leaders.map((row, index) => {
      const base = { position: row.position, shortTitle: row.shortTitle, sortOrder: index };
      if (!row.membershipId) {
        return { ...base, membershipId: null, personName: row.personName, phone: row.phone };
      }
      const before = row.id ? storedById.get(row.id) : undefined;
      if (before && before.membershipId === row.membershipId) {
        return {
          ...base,
          membershipId: row.membershipId,
          personName: before.personName,
          phone: before.phone,
        };
      }
      const profile = profiles.get(row.membershipId);
      return {
        ...base,
        membershipId: profile ? row.membershipId : null,
        personName: profile?.name.trim() || null,
        phone: profile?.phone?.trim() || null,
      };
    }),
    crewCalls: data.crewCalls
      .map((row) => ({
        departmentId: row.departmentId,
        label:
          row.label ?? (row.departmentId ? (departmentNames.get(row.departmentId) ?? "") : ""),
        callTime: row.callTime,
      }))
      .filter((row) => row.label.trim() !== "")
      .map((row, index) => ({ ...row, sortOrder: index })),
    baseItems: data.baseItems.map((row, index) => ({ ...row, sortOrder: index })),
  };
}

/** Для журнала: без телефонов. */
export function sheetAuditView(
  data: Pick<
    CallSheetSheetData,
    "tempDay" | "tempNight" | "importantNote" | "actorRestrictions" | "schemeLocationId"
  >,
  rows: SheetRows,
) {
  return {
    tempDay: data.tempDay,
    tempNight: data.tempNight,
    importantNote: data.importantNote,
    actorRestrictions: data.actorRestrictions,
    schemeLocationId: data.schemeLocationId,
    leaders: rows.leaders.map((row) => ({
      position: row.position,
      shortTitle: row.shortTitle,
      person: row.personName,
    })),
    crewCalls: rows.crewCalls.map((row) => ({ name: row.label, callTime: row.callTime })),
    baseItems: rows.baseItems.map((row) => ({
      name: row.name,
      callTime: row.callTime,
      notNeeded: row.notNeeded,
    })),
  };
}
