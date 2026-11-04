import type { CrewMemberSource } from "@prisma/client";

import type { Permission } from "@/features/memberships/permissions";

/** Ключ системного статуса: договор с ним считается отклонённым (см. approval-statuses.ts). */
export const REJECTED_CONTRACT_STATUS_KEY = "REJECTED";

export const NO_DEPARTMENT_TITLE = "Без цеха";

/** Что можно зрителю в «Команде», кроме самого просмотра (`crew:read` проверяет страница). */
export type CrewRights = {
  write: boolean;
  /** Телефон и почта. */
  contacts: boolean;
  /** Номер, дата и статус договора. Суммы в команде не показываются никому. */
  contracts: boolean;
};

export function crewRights(can: (permission: Permission) => boolean): CrewRights {
  return {
    write: can("crew:write"),
    contacts: can("crew:contacts"),
    contracts: can("contracts:read"),
  };
}

export type CrewRowContract = {
  id: string;
  number: string;
  date: string;
  statusName: string;
  statusColor: string;
  rejected: boolean;
};

/** Строка для браузера. Необязательные поля приходят, только если на них есть право. */
export type CrewRow = {
  id: string;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  position: string | null;
  departmentId: string | null;
  departmentName: string | null;
  note: string | null;
  sortOrder: number;
  source: CrewMemberSource;
  archived: boolean;
  phone?: string | null;
  email?: string | null;
  contracts?: CrewRowContract[];
};

/** Запись из базы, из которой собирается строка. Лишние поля записи в браузер не уходят. */
export type CrewRecord = Omit<
  CrewRow,
  "archived" | "departmentName" | "phone" | "email" | "contracts"
> & {
  archivedAt: Date | null;
  department: { name: string } | null;
  phone: string | null;
  email: string | null;
  contractLinks?: {
    contract: {
      id: string;
      number: string;
      date: Date;
      status: { key: string | null; name: string; color: string };
    };
  }[];
};

/**
 * Единственное место, где данные команды становятся строкой для браузера: список, карточка
 * и экспорт идут через него. Поля перечислены явно, поэтому снимок договора и всё, что
 * появится в модели потом, наружу сами не попадут.
 */
export function toCrewRow(record: CrewRecord, rights: CrewRights): CrewRow {
  const row: CrewRow = {
    id: record.id,
    lastName: record.lastName,
    firstName: record.firstName,
    middleName: record.middleName,
    position: record.position,
    departmentId: record.departmentId,
    departmentName: record.department?.name ?? null,
    note: record.note,
    sortOrder: record.sortOrder,
    source: record.source,
    archived: record.archivedAt != null,
  };
  if (rights.contacts) {
    row.phone = record.phone;
    row.email = record.email;
  }
  if (rights.contracts) {
    row.contracts = (record.contractLinks ?? [])
      .map(({ contract }) => ({
        id: contract.id,
        number: contract.number,
        date: contract.date.toISOString(),
        statusName: contract.status.name,
        statusColor: contract.status.color,
        rejected: contract.status.key === REJECTED_CONTRACT_STATUS_KEY,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  return row;
}

export function crewFullName(person: {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
}): string {
  return [person.lastName, person.firstName, person.middleName].filter(Boolean).join(" ");
}

/** Адрес для `tel:`. Телефон хранится как ввели; без цифр или слишком короткий — без ссылки. */
export function crewPhoneHref(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5) return null;
  if (digits.length === 11 && digits.startsWith("8")) return `tel:+7${digits.slice(1)}`;
  return `tel:${raw.startsWith("+") ? "+" : ""}${digits}`;
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/**
 * Поиск в браузере по тому, что пришло с сервера. Телефона без права в строке нет, поэтому
 * и найти по нему нельзя; серверного поиска, которым можно подобрать номер, нет вообще.
 */
export function matchesCrewSearch(row: CrewRow, query: string): boolean {
  const q = normalizeText(query.trim());
  if (!q) return true;
  const text = normalizeText([crewFullName(row), row.position ?? ""].join(" "));
  if (text.includes(q)) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3 || !row.phone) return false;
  const stored = row.phone.replace(/\D/g, "");
  // «8 900…» и «+7 900…» — один номер, поэтому первая цифра запроса может быть кодом страны.
  return stored.includes(digits) || stored.includes(digits.replace(/^[78]/, ""));
}

export type CrewDepartment = { id: string; name: string };

export type CrewGroup = {
  key: string;
  departmentId: string | null;
  title: string;
  rows: CrewRow[];
};

export function compareCrewRows(a: CrewRow, b: CrewRow): number {
  return (
    a.sortOrder - b.sortOrder ||
    a.lastName.localeCompare(b.lastName, "ru") ||
    (a.firstName ?? "").localeCompare(b.firstName ?? "", "ru")
  );
}

/** Цеха в порядке проекта, без цеха — в конце. Пустых групп нет. */
export function groupCrewRows(rows: CrewRow[], departments: CrewDepartment[]): CrewGroup[] {
  const known = new Set(departments.map((d) => d.id));
  const groups: CrewGroup[] = departments.map((d) => ({
    key: d.id,
    departmentId: d.id,
    title: d.name,
    rows: rows.filter((r) => r.departmentId === d.id),
  }));
  groups.push({
    key: "none",
    departmentId: null,
    title: NO_DEPARTMENT_TITLE,
    rows: rows.filter((r) => !r.departmentId || !known.has(r.departmentId)),
  });
  return groups
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ ...g, rows: [...g.rows].sort(compareCrewRows) }));
}

/** Поля записи, которые правит форма. */
export type CrewFormData = {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  position: string | null;
  departmentId: string | null;
  note: string | null;
  phone: string | null;
  email: string | null;
};

/**
 * Что пишется в базу. Без права на контакты телефона и почты нет в данных вовсе: при правке
 * они остаются прежними, что бы ни прислал браузер, при создании — пустые.
 */
export function crewWriteData(
  form: CrewFormData,
  rights: Pick<CrewRights, "contacts">,
): Omit<CrewFormData, "phone" | "email"> & { phone?: string | null; email?: string | null } {
  const { phone, email, ...rest } = form;
  return rights.contacts ? { ...rest, phone, email } : rest;
}

const AUDIT_FIELD_LABELS = {
  lastName: "Фамилия",
  firstName: "Имя",
  middleName: "Отчество",
  position: "Должность",
  department: "Цех",
  note: "Заметка",
} as const;

const AUDIT_CONTACT_LABELS = { phone: "Телефон", email: "Почта" } as const;

/** Журнал читают и без права на контакты: сам факт смены есть, значений нет. */
export const AUDIT_HIDDEN_VALUE = "скрыто";

type AuditSide = Partial<
  Record<keyof typeof AUDIT_FIELD_LABELS | keyof typeof AUDIT_CONTACT_LABELS, string | null>
>;

/** `changes` для журнала: что изменилось. Телефон и почта — без значений. */
export function crewAuditChanges(before: AuditSide, after: AuditSide) {
  const fields: Record<string, { from: string | null; to: string | null }> = {};
  for (const [key, label] of Object.entries(AUDIT_FIELD_LABELS)) {
    const k = key as keyof typeof AUDIT_FIELD_LABELS;
    if (!(k in after)) continue;
    const from = before[k] ?? null;
    const to = after[k] ?? null;
    if (from !== to) fields[label] = { from, to };
  }
  for (const [key, label] of Object.entries(AUDIT_CONTACT_LABELS)) {
    const k = key as keyof typeof AUDIT_CONTACT_LABELS;
    if (!(k in after)) continue;
    if ((before[k] ?? null) !== (after[k] ?? null)) {
      fields[label] = { from: AUDIT_HIDDEN_VALUE, to: AUDIT_HIDDEN_VALUE };
    }
  }
  return { fields };
}
