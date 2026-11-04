import type { CounterpartyType } from "@prisma/client";

import { parseContacts, parseCounterpartyName } from "@/features/crew/lib/crew-parse";
import {
  crewFullName,
  REJECTED_CONTRACT_STATUS_KEY,
  type CrewRights,
} from "@/features/crew/lib/crew-rules";

/**
 * Логика связи «человек — договор»: что предложить в «Подтянуть», с кем сравнить, что
 * показать в «Обновить из договора». Без базы: всё здесь проверяется юнитами.
 */

export const PULLABLE_COUNTERPARTY_TYPES = [
  "INDIVIDUAL",
  "SELF_EMPLOYED",
  "IP",
] as const satisfies readonly CounterpartyType[];

export const CREW_SYNC_FIELDS = ["lastName", "firstName", "middleName", "phone", "email"] as const;
export type CrewSyncField = (typeof CREW_SYNC_FIELDS)[number];
export type CrewSyncValues = Record<CrewSyncField, string | null>;

const NAME_FIELDS = ["lastName", "firstName", "middleName"] as const satisfies readonly CrewSyncField[];
const CONTACT_FIELDS = ["phone", "email"] as const satisfies readonly CrewSyncField[];

const FIELD_LABELS: Record<CrewSyncField, string> = {
  lastName: "Фамилия",
  firstName: "Имя",
  middleName: "Отчество",
  phone: "Телефон",
  email: "Почта",
};

export type CrewCounterparty = { name: string; type: CounterpartyType; contacts: string | null };

export function isPullableCounterparty(type: CounterpartyType): boolean {
  return (PULLABLE_COUNTERPARTY_TYPES as readonly CounterpartyType[]).includes(type);
}

export function isRejectedStatus(status: { key: string | null }): boolean {
  return status.key === REJECTED_CONTRACT_STATUS_KEY;
}

/** Что сейчас можно взять из контрагента. У ООО имя — название фирмы, поэтому ФИО нет. */
export function counterpartyValues(counterparty: CrewCounterparty): CrewSyncValues {
  const contacts = parseContacts(counterparty.contacts);
  if (counterparty.type === "LEGAL_ENTITY") {
    return { lastName: null, firstName: null, middleName: null, ...contacts };
  }
  const { lastName, firstName, middleName } = parseCounterpartyName(
    counterparty.name,
    counterparty.type,
  );
  return { lastName: lastName || null, firstName, middleName, ...contacts };
}

/** Поля, которые этот зритель может брать из этого договора. */
export function crewSyncScope(
  type: CounterpartyType,
  rights: Pick<CrewRights, "contacts">,
): CrewSyncField[] {
  return [
    ...(type === "LEGAL_ENTITY" ? [] : NAME_FIELDS),
    ...(rights.contacts ? CONTACT_FIELDS : []),
  ];
}

/**
 * Снимок при «Подтянуть»: то, что было в договоре, а не то, что поправили в окне. Иначе
 * правка в окне не считалась бы ручной. Без права на контакты телефона и почты в снимке нет,
 * поэтому тот, у кого право есть, увидит их в «Обновить» как новые данные договора.
 */
export function pullSnapshot(
  counterparty: CrewCounterparty,
  rights: Pick<CrewRights, "contacts">,
): Partial<CrewSyncValues> {
  const values = counterpartyValues(counterparty);
  return Object.fromEntries(
    crewSyncScope(counterparty.type, rights).map((field) => [field, values[field]]),
  );
}

/** Снимок из базы: JSON, поля могут отсутствовать. */
export function readCrewSnapshot(value: unknown): Partial<CrewSyncValues> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const snapshot: Partial<CrewSyncValues> = {};
  for (const field of CREW_SYNC_FIELDS) {
    const item = source[field];
    if (typeof item === "string" || item === null) snapshot[field] = item;
  }
  return snapshot;
}

function samePhone(a: string, b: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
  return digits(a) === digits(b);
}

function sameSyncValue(field: CrewSyncField, a: string | null, b: string | null): boolean {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (left === null || right === null) return left === right;
  // Один номер, написанный по-разному, — не разница.
  return field === "phone" ? samePhone(left, right) : left === right;
}

export type CrewSyncRow = {
  field: CrewSyncField;
  label: string;
  /** Сейчас в команде. */
  current: string | null;
  /** Значение последней синхронизации. */
  snapshot: string | null;
  /** Сейчас в договоре. */
  contract: string | null;
  changedInContract: boolean;
  changedManually: boolean;
  /** Отмечено по умолчанию. Ручные правки молча не затираются. */
  checked: boolean;
};

/** Отличия записи от договора. Полей вне `crewSyncScope` здесь нет: в браузер они не уходят. */
export function crewSyncRows(
  member: CrewSyncValues,
  snapshotJson: unknown,
  counterparty: CrewCounterparty,
  rights: Pick<CrewRights, "contacts">,
): CrewSyncRow[] {
  const snapshot = readCrewSnapshot(snapshotJson);
  const values = counterpartyValues(counterparty);
  const rows: CrewSyncRow[] = [];
  for (const field of crewSyncScope(counterparty.type, rights)) {
    const current = member[field];
    const contract = values[field];
    if (sameSyncValue(field, current, contract)) continue;
    // Без фамилии запись невозможна: стереть её нечем.
    if (field === "lastName" && contract === null) continue;
    const saved = snapshot[field] ?? null;
    const changedInContract = !sameSyncValue(field, contract, saved);
    const changedManually = !sameSyncValue(field, current, saved);
    rows.push({
      field,
      label: FIELD_LABELS[field],
      current,
      snapshot: saved,
      contract,
      changedInContract,
      changedManually,
      // В договоре поле опустело: стирать данные человека без явной галочки не будем.
      checked: changedInContract && !changedManually && contract !== null,
    });
  }
  return rows;
}

export type CrewSyncPlan = {
  /** Что записать в человека. */
  data: Partial<CrewSyncValues>;
  /** Новый снимок. Не применённые отличия в нём не меняются и будут видны в следующий раз. */
  snapshot: Partial<CrewSyncValues>;
  labels: string[];
};

/**
 * Что сделать по выбранным полям. Значения берутся из договора, а не из браузера; поле, которого
 * нет среди отличий (нет права, ООО, подделанный запрос), просто не применяется.
 */
export function crewSyncPlan(
  member: CrewSyncValues,
  snapshotJson: unknown,
  counterparty: CrewCounterparty,
  rights: Pick<CrewRights, "contacts">,
  requested: readonly CrewSyncField[],
): CrewSyncPlan {
  const picked = crewSyncRows(member, snapshotJson, counterparty, rights).filter((row) =>
    requested.includes(row.field),
  );
  const data: Partial<CrewSyncValues> = Object.fromEntries(
    picked.map((row) => [row.field, row.contract]),
  );
  const values = counterpartyValues(counterparty);
  const snapshot = readCrewSnapshot(snapshotJson);
  for (const field of crewSyncScope(counterparty.type, rights)) {
    if (field in data || sameSyncValue(field, member[field], values[field])) {
      snapshot[field] = values[field];
    }
  }
  return { data, snapshot, labels: picked.map((row) => row.label) };
}

function normalizeName(value: string | null): string {
  return (value ?? "").trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\.$/, "");
}

/** Пусто, совпадает или одно из значений — инициал другого. */
function namePartsMatch(a: string | null, b: string | null): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right || left === right) return true;
  return left[0] === right[0] && (left.length === 1 || right.length === 1);
}

type PersonName = { lastName: string; firstName: string | null; middleName: string | null };

/** Похожее ФИО: фамилия совпадает, имя и отчество не противоречат. */
export function isSimilarCrewName(a: PersonName, b: PersonName): boolean {
  return (
    normalizeName(a.lastName) !== "" &&
    normalizeName(a.lastName) === normalizeName(b.lastName) &&
    namePartsMatch(a.firstName, b.firstName) &&
    namePartsMatch(a.middleName, b.middleName)
  );
}

export type CrewMatch = { id: string; name: string; archived: boolean };

export type CrewMatchRecord = PersonName & {
  id: string;
  phone: string | null;
  archivedAt: Date | null;
};

function toCrewMatch(member: CrewMatchRecord): CrewMatch {
  return { id: member.id, name: crewFullName(member), archived: member.archivedAt != null };
}

/** Кто из команды похож на человека из договора. Телефон сравнивается только при праве на него. */
export function findCrewMatches(
  person: PersonName & { phone: string | null },
  members: CrewMatchRecord[],
  rights: Pick<CrewRights, "contacts">,
): CrewMatch[] {
  return members
    .filter(
      (member) =>
        isSimilarCrewName(person, member) ||
        (rights.contacts &&
          person.phone != null &&
          member.phone != null &&
          samePhone(person.phone, member.phone)),
    )
    .map(toCrewMatch);
}

/** Цех по статьям сметы из начислений договора: самый частый, при равенстве — более свежий. */
export function suggestCrewDepartment(
  accruals: { date: Date; budgetItem: { departmentId: string } | null }[],
): string | null {
  const seen = new Map<string, { count: number; latest: number }>();
  for (const accrual of accruals) {
    const id = accrual.budgetItem?.departmentId;
    if (!id) continue;
    const entry = seen.get(id) ?? { count: 0, latest: 0 };
    seen.set(id, {
      count: entry.count + 1,
      latest: Math.max(entry.latest, accrual.date.getTime()),
    });
  }
  const best = [...seen.entries()].sort(
    ([, a], [, b]) => b.count - a.count || b.latest - a.latest,
  )[0];
  return best?.[0] ?? null;
}

export type CrewPullContract = {
  id: string;
  number: string;
  date: string;
  statusName: string;
  statusColor: string;
};

/** Строка окна «Подтянуть»: контрагент и его договоры, которых ещё нет в команде. */
export type CrewPullCandidate = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyType: CounterpartyType;
  contracts: CrewPullContract[];
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  departmentId: string | null;
  /** Только при праве на контакты: без него ключей нет. */
  phone?: string | null;
  email?: string | null;
  /** Контрагент уже в команде: договор просто свяжется с этим человеком. */
  inTeam: CrewMatch | null;
  /** Похожие люди, если контрагента в команде ещё нет. */
  similar: CrewMatch[];
};

export type CrewPullRecord = CrewCounterparty & {
  id: string;
  contracts: {
    id: string;
    number: string;
    date: Date;
    status: { key: string | null; name: string; color: string };
    crewLinks: { crewMemberId: string }[];
    accruals: { date: Date; budgetItem: { departmentId: string } | null }[];
  }[];
};

/**
 * Единственное место, где данные контрагента становятся строкой окна «Подтянуть». `null` —
 * показывать нечего: ООО, все договоры отклонены или уже связаны. Контакты контрагента
 * целиком наружу не уходят никогда, только разобранные телефон и почта при праве.
 */
export function toCrewPullCandidate(
  record: CrewPullRecord,
  members: CrewMatchRecord[],
  rights: Pick<CrewRights, "contacts">,
): CrewPullCandidate | null {
  if (!isPullableCounterparty(record.type)) return null;
  const contracts = record.contracts
    .filter((c) => !isRejectedStatus(c.status) && c.crewLinks.length === 0)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  if (contracts.length === 0) return null;

  const values = counterpartyValues(record);
  const person = {
    lastName: values.lastName ?? "",
    firstName: values.firstName,
    middleName: values.middleName,
  };
  const linkedId = record.contracts.flatMap((c) => c.crewLinks)[0]?.crewMemberId;
  const linked = linkedId ? members.find((m) => m.id === linkedId) : undefined;

  const candidate: CrewPullCandidate = {
    counterpartyId: record.id,
    counterpartyName: record.name,
    counterpartyType: record.type,
    contracts: contracts.map((c) => ({
      id: c.id,
      number: c.number,
      date: c.date.toISOString(),
      statusName: c.status.name,
      statusColor: c.status.color,
    })),
    ...person,
    departmentId: suggestCrewDepartment(contracts.flatMap((c) => c.accruals)),
    inTeam: linked ? toCrewMatch(linked) : null,
    similar: linked ? [] : findCrewMatches({ ...person, phone: values.phone }, members, rights),
  };
  if (rights.contacts) {
    candidate.phone = values.phone;
    candidate.email = values.email;
  }
  return candidate;
}
