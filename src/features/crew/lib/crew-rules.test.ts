import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AUDIT_HIDDEN_VALUE,
  crewAuditChanges,
  crewPhoneHref,
  crewRights,
  crewWriteData,
  groupCrewRows,
  matchesCrewSearch,
  NO_DEPARTMENT_TITLE,
  toCrewRow,
  type CrewRecord,
  type CrewRights,
  type CrewRow,
} from "@/features/crew/lib/crew-rules";
import { crewMemberFormSchema } from "@/features/crew/schemas";

const PHONE = "+7 900 123-45-67";
const EMAIL = "ivanov@example.com";

const record: CrewRecord & { syncedValues: unknown; createdById: string } = {
  id: "m1",
  lastName: "Иванов",
  firstName: "Иван",
  middleName: null,
  position: "Осветитель",
  departmentId: "d1",
  department: { name: "Светотехники" },
  note: "Заметка",
  sortOrder: 0,
  source: "CONTRACT",
  archivedAt: null,
  phone: PHONE,
  email: EMAIL,
  syncedValues: { phone: PHONE, email: EMAIL },
  createdById: "u1",
  contractLinks: [
    {
      contract: {
        id: "c1",
        number: "К-1",
        date: new Date("2026-01-01T00:00:00.000Z"),
        status: { key: "SIGNED_SCAN", name: "Подписан (скан)", color: "#14b8a6" },
      },
    },
    {
      contract: {
        id: "c2",
        number: "К-2",
        date: new Date("2026-03-01T00:00:00.000Z"),
        status: { key: "REJECTED", name: "Отклонён", color: "#f43f5e" },
      },
    },
  ],
};

const NOTHING: CrewRights = { write: false, contacts: false, contracts: false };
const row = (rights: Partial<CrewRights> = {}) => toCrewRow(record, { ...NOTHING, ...rights });

describe("toCrewRow: что уходит в браузер", () => {
  test("без «Контактов» телефона и почты нет даже как ключей", () => {
    const out = row();
    assert.equal("phone" in out, false);
    assert.equal("email" in out, false);
    assert.equal(JSON.stringify(out).includes(PHONE), false);
    assert.equal(JSON.stringify(out).includes(EMAIL), false);
  });

  test("с «Контактами» телефон и почта есть", () => {
    const out = row({ contacts: true });
    assert.equal(out.phone, PHONE);
    assert.equal(out.email, EMAIL);
  });

  test("без права на договоры данных договора нет, источник есть", () => {
    const out = row();
    assert.equal("contracts" in out, false);
    assert.equal(out.source, "CONTRACT");
    assert.equal(JSON.stringify(out).includes("К-1"), false);
  });

  test("с правом на договоры: новые сверху, отклонённый отмечен", () => {
    const contracts = row({ contracts: true }).contracts ?? [];
    assert.deepEqual(contracts.map((c) => c.number), ["К-2", "К-1"]);
    assert.equal(contracts[0]?.rejected, true);
    assert.equal(contracts[1]?.rejected, false);
  });

  test("снимок договора и служебные поля не уходят ни при каких правах", () => {
    const out = row({ write: true, contacts: true, contracts: true });
    assert.equal("syncedValues" in out, false);
    assert.equal("createdById" in out, false);
  });
});

describe("crewRights", () => {
  test("права берутся из своих разрешений", () => {
    assert.deepEqual(crewRights((p) => p === "contracts:read"), {
      write: false,
      contacts: false,
      contracts: true,
    });
    assert.deepEqual(crewRights((p) => p === "crew:contacts"), {
      write: false,
      contacts: true,
      contracts: false,
    });
  });
});

describe("crewWriteData: правка без «Контактов»", () => {
  const form = {
    lastName: "Иванов",
    firstName: null,
    middleName: null,
    position: null,
    departmentId: null,
    note: null,
    phone: "подделка",
    email: "x@y.zz",
  };

  test("без права полей контактов нет: базе нечего стирать", () => {
    const data = crewWriteData(form, { contacts: false });
    assert.equal("phone" in data, false);
    assert.equal("email" in data, false);
  });

  test("с правом контакты пишутся", () => {
    const data = crewWriteData(form, { contacts: true });
    assert.equal(data.phone, "подделка");
    assert.equal(data.email, "x@y.zz");
  });
});

describe("matchesCrewSearch", () => {
  const withPhone = row({ contacts: true });

  test("ФИО и должность, регистр и ё", () => {
    assert.equal(matchesCrewSearch(withPhone, "иванов"), true);
    assert.equal(matchesCrewSearch(withPhone, "ОСВЕТИТЕЛЬ"), true);
    const fedor: CrewRow = { ...withPhone, lastName: "Фёдоров" };
    assert.equal(matchesCrewSearch(fedor, "федоров"), true);
  });

  test("телефон в любом написании: «8 900…» и «+7 900…» — один номер", () => {
    assert.equal(matchesCrewSearch(withPhone, "8 900 123"), true);
    assert.equal(matchesCrewSearch(withPhone, "+7 (900) 123-45-67"), true);
    assert.equal(matchesCrewSearch(withPhone, "4567"), true);
    assert.equal(matchesCrewSearch(withPhone, "555"), false);
  });

  test("без права по телефону не ищет", () => {
    const without = row();
    assert.equal(matchesCrewSearch(without, "900 123"), false);
    assert.equal(matchesCrewSearch(without, "4567"), false);
  });

  test("пустой запрос — все", () => {
    assert.equal(matchesCrewSearch(row(), "  "), true);
  });
});

describe("crewPhoneHref", () => {
  test("номер приводится к международному виду, как ввели — не меняется в базе", () => {
    assert.equal(crewPhoneHref("+7 (900) 123-45-67"), "tel:+79001234567");
    assert.equal(crewPhoneHref("8 900 123-45-67"), "tel:+79001234567");
    assert.equal(crewPhoneHref("12-34-56"), "tel:123456");
  });

  test("пусто и без цифр — без ссылки", () => {
    assert.equal(crewPhoneHref(null), null);
    assert.equal(crewPhoneHref("  "), null);
    assert.equal(crewPhoneHref("спросить у Ани"), null);
  });
});

describe("groupCrewRows", () => {
  const departments = [
    { id: "d1", name: "Свет" },
    { id: "d2", name: "Звук" },
  ];
  const person = (over: Partial<CrewRow>): CrewRow => ({ ...row(), ...over });

  test("цеха по порядку проекта, без цеха — в конце, пустых групп нет", () => {
    const groups = groupCrewRows(
      [
        person({ id: "a", departmentId: null, departmentName: null }),
        person({ id: "b", departmentId: "d2" }),
      ],
      departments,
    );
    assert.deepEqual(groups.map((g) => g.title), ["Звук", NO_DEPARTMENT_TITLE]);
  });

  test("внутри цеха — по порядку, потом по фамилии", () => {
    const groups = groupCrewRows(
      [
        person({ id: "z", lastName: "Яковлев", sortOrder: 0 }),
        person({ id: "a", lastName: "Абрамов", sortOrder: 0 }),
        person({ id: "m", lastName: "Мухин", sortOrder: -1 }),
      ],
      departments,
    );
    assert.deepEqual(groups[0]?.rows.map((r) => r.id), ["m", "a", "z"]);
  });

  test("человек из удалённого цеха попадает в «Без цеха»", () => {
    const groups = groupCrewRows([person({ id: "a", departmentId: "старый" })], departments);
    assert.equal(groups[0]?.title, NO_DEPARTMENT_TITLE);
  });
});

describe("crewAuditChanges: журнал", () => {
  test("значений телефона и почты нет, факт смены есть", () => {
    const changes = crewAuditChanges(
      { phone: PHONE, email: EMAIL, position: "Осветитель" },
      { phone: "+7 900 000-00-00", email: "new@example.com", position: "Бригадир" },
    );
    const text = JSON.stringify(changes);
    assert.equal(text.includes(PHONE), false);
    assert.equal(text.includes("+7 900 000-00-00"), false);
    assert.equal(text.includes(EMAIL), false);
    assert.equal(text.includes("new@example.com"), false);
    assert.deepEqual(changes.fields["Телефон"], {
      from: AUDIT_HIDDEN_VALUE,
      to: AUDIT_HIDDEN_VALUE,
    });
    assert.deepEqual(changes.fields["Должность"], { from: "Осветитель", to: "Бригадир" });
  });

  test("контакты, которых нет в правке, не упоминаются", () => {
    const changes = crewAuditChanges({ phone: PHONE, note: "а" }, { note: "б" });
    assert.deepEqual(Object.keys(changes.fields), ["Заметка"]);
  });

  test("без изменений — пусто", () => {
    assert.deepEqual(crewAuditChanges({ note: "а" }, { note: "а" }).fields, {});
  });
});

describe("crewMemberFormSchema", () => {
  const base = { lastName: "Иванов" };

  test("нужна только фамилия, пустое становится null", () => {
    const parsed = crewMemberFormSchema.parse({ ...base, firstName: "  ", departmentId: "" });
    assert.equal(parsed.firstName, null);
    assert.equal(parsed.departmentId, null);
    assert.equal(parsed.phone, null);
  });

  test("без фамилии — ошибка", () => {
    assert.equal(crewMemberFormSchema.safeParse({ lastName: "  " }).success, false);
  });

  test("почта проверяется просто", () => {
    assert.equal(crewMemberFormSchema.safeParse({ ...base, email: "нет" }).success, false);
    assert.equal(crewMemberFormSchema.safeParse({ ...base, email: "a@b.ru" }).success, true);
  });

  test("телефон хранится как ввели", () => {
    const parsed = crewMemberFormSchema.parse({ ...base, phone: "8 (900) 123-45-67 доб. 2" });
    assert.equal(parsed.phone, "8 (900) 123-45-67 доб. 2");
  });
});
