import { z } from "zod";
import { optionalPhoneSchema } from "@/shared/lib/phone";

/** Время «ЧЧ:ММ» (00:00–23:59). Пусто — без времени. */
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
    .max(max)
    .transform((v) => (v === "" ? null : v));

const optionalId = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v === "" ? null : v));

export const MAX_TEMPLATE_ROWS = 100;

const leaderSchema = z
  .object({
    position: z.string().trim().min(1, "Укажите должность руководителя").max(100),
    shortTitle: optionalText(40),
    membershipId: optionalId,
    personName: optionalText(200),
    phone: optionalPhoneSchema,
  })
  // Участник проекта: имя и телефон — из профиля, свои не храним.
  .transform((row) =>
    row.membershipId ? { ...row, personName: null, phone: null } : row,
  );

const crewCallSchema = z
  .object({
    departmentId: optionalId,
    label: optionalText(100),
    callTime: optionalTime,
  })
  .refine((row) => row.departmentId !== null || row.label !== null, {
    message: "В строке вызова выберите цех или впишите название",
  })
  .transform((row) => (row.departmentId ? { ...row, label: null } : row));

const baseItemSchema = z.object({
  name: z.string().trim().min(1, "Укажите наименование в «Базе и транспорте»").max(200),
  callTime: optionalTime,
  notNeeded: z.boolean(),
});

/** Весь шаблон. Порядок строк — порядок в массивах. */
export const callSheetTemplateSchema = z
  .object({
    leaders: z.array(leaderSchema).max(MAX_TEMPLATE_ROWS, "Слишком много строк"),
    crewCalls: z.array(crewCallSchema).max(MAX_TEMPLATE_ROWS, "Слишком много строк"),
    baseItems: z.array(baseItemSchema).max(MAX_TEMPLATE_ROWS, "Слишком много строк"),
  })
  .superRefine((data, ctx) => {
    const departments = data.crewCalls
      .map((row) => row.departmentId)
      .filter((id): id is string => id !== null);
    if (new Set(departments).size < departments.length) {
      ctx.addIssue({ code: "custom", message: "Один цех добавлен в вызов дважды" });
    }
  });

export type CallSheetTemplateData = z.infer<typeof callSheetTemplateSchema>;

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Некорректные данные";
}

/** Разбор JSON шаблона из формы. */
export function parseTemplatePayload(
  raw: unknown,
): { data: CallSheetTemplateData } | { error: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { error: "Некорректные данные" };
    }
  }
  const parsed = callSheetTemplateSchema.safeParse(value);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return { data: parsed.data };
}

export const NO_RIGHTS = "Недостаточно прав";
export const MEMBER_NOT_FOUND =
  "Участник вышел из проекта или не найден — выберите в шаблоне другого";
export const DEPARTMENT_NOT_FOUND = "Цех не найден";
export const DAY_NOT_FOUND = "Съёмочный день не найден";

/** Право правки шаблона и вызывных — «КПП и вызывные: правка». */
export function canEditCallSheets(access: {
  can: (permission: "callsheet:write" | "schedule:write") => boolean;
}): boolean {
  return access.can("callsheet:write") || access.can("schedule:write");
}

/** Проверка, что id принадлежат проекту. false — чужой или нет записи. */
export type InProjectCheck = (
  entity: "ProjectMembership" | "Department" | "ShootDay" | "Location",
  ids: string[],
) => Promise<boolean>;

/**
 * Проверки сохранения шаблона до записи: право, данные, участники и цеха — этого проекта.
 */
export async function checkTemplateSave(
  deps: { canEdit: boolean; inProject: InProjectCheck },
  raw: unknown,
): Promise<{ data: CallSheetTemplateData } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  const parsed = parseTemplatePayload(raw);
  if ("error" in parsed) return parsed;
  const { data } = parsed;

  const memberIds = data.leaders
    .map((row) => row.membershipId)
    .filter((id): id is string => id !== null);
  if (!(await deps.inProject("ProjectMembership", memberIds))) {
    return { error: MEMBER_NOT_FOUND };
  }
  const departmentIds = data.crewCalls
    .map((row) => row.departmentId)
    .filter((id): id is string => id !== null);
  if (!(await deps.inProject("Department", departmentIds))) {
    return { error: DEPARTMENT_NOT_FOUND };
  }
  return { data };
}

/** Проверки «Создать вызывной» и «Обновить из шаблона» до записи: право и день проекта. */
export async function checkCallSheetCommand(
  deps: { canEdit: boolean; inProject: InProjectCheck },
  dayId: unknown,
): Promise<{ dayId: string } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  if (typeof dayId !== "string" || dayId.trim() === "" || dayId.length > 100) {
    return { error: DAY_NOT_FOUND };
  }
  if (!(await deps.inProject("ShootDay", [dayId]))) return { error: DAY_NOT_FOUND };
  return { dayId };
}

/** Строки шаблона, как они лежат в базе, с данными участника и цеха. */
export type TemplateForCopy = {
  leaders: {
    position: string;
    shortTitle: string | null;
    membershipId: string | null;
    personName: string | null;
    phone: string | null;
    /** Участник: null — не найден или не активен. */
    member: { name: string; phone: string | null } | null;
  }[];
  crewCalls: {
    departmentId: string | null;
    label: string | null;
    departmentName: string | null;
    callTime: string | null;
  }[];
  baseItems: { name: string; callTime: string | null; notNeeded: boolean }[];
};

export type CallSheetCopies = {
  leaders: {
    position: string;
    shortTitle: string | null;
    membershipId: string | null;
    personName: string | null;
    phone: string | null;
    sortOrder: number;
  }[];
  crewCalls: {
    departmentId: string | null;
    label: string;
    callTime: string | null;
    sortOrder: number;
  }[];
  baseItems: { name: string; callTime: string | null; notNeeded: boolean; sortOrder: number }[];
};

/**
 * Копия шаблона для вызывного (снимок): ФИ и телефон участника — из профиля на этот момент,
 * название цеха — текущее. Участник не активен — строка остаётся без человека.
 * Порядок — порядок шаблона, sortOrder с нуля подряд.
 */
export function buildCallSheetCopies(template: TemplateForCopy): CallSheetCopies {
  return {
    leaders: template.leaders.map((row, index) => {
      if (row.membershipId) {
        return {
          position: row.position,
          shortTitle: row.shortTitle,
          membershipId: row.member ? row.membershipId : null,
          personName: row.member?.name.trim() || null,
          phone: row.member?.phone?.trim() || null,
          sortOrder: index,
        };
      }
      return {
        position: row.position,
        shortTitle: row.shortTitle,
        membershipId: null,
        personName: row.personName,
        phone: row.phone,
        sortOrder: index,
      };
    }),
    crewCalls: template.crewCalls
      .map((row) => ({
        departmentId: row.departmentId,
        label: (row.departmentId ? row.departmentName : row.label)?.trim() ?? "",
        callTime: row.callTime,
      }))
      .filter((row) => row.label !== "")
      .map((row, index) => ({ ...row, sortOrder: index })),
    baseItems: template.baseItems.map((row, index) => ({
      name: row.name,
      callTime: row.callTime,
      notNeeded: row.notNeeded,
      sortOrder: index,
    })),
  };
}

/** Для журнала: строки шаблона без телефонов (персональные данные в аудит не пишем). */
export function templateAuditView(
  data: CallSheetTemplateData,
  names: { members: Map<string, string>; departments: Map<string, string> },
) {
  return {
    leaders: data.leaders.map((row) => ({
      position: row.position,
      shortTitle: row.shortTitle,
      person: row.membershipId
        ? (names.members.get(row.membershipId) ?? "участник")
        : row.personName,
    })),
    crewCalls: data.crewCalls.map((row) => ({
      name: row.departmentId
        ? (names.departments.get(row.departmentId) ?? "цех")
        : row.label,
      callTime: row.callTime,
    })),
    baseItems: data.baseItems.map((row) => ({
      name: row.name,
      callTime: row.callTime,
      notNeeded: row.notNeeded,
    })),
  };
}
