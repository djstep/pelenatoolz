import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  counterpartyValues,
  crewSyncPlan,
  crewSyncRows,
  crewSyncScope,
  findCrewMatches,
  isSimilarCrewName,
  pullSnapshot,
  readCrewSnapshot,
  suggestCrewDepartment,
  toCrewPullCandidate,
  type CrewCounterparty,
  type CrewMatchRecord,
  type CrewPullRecord,
  type CrewSyncValues,
} from "@/features/crew/lib/crew-sync";
import { crewMainContract, crewContractMark, type CrewRow, type CrewRowContract } from "@/features/crew/lib/crew-rules";

const PHONE = "+7 900 111-22-33";
const EMAIL = "ivanov@example.com";
const WITH_CONTACTS = { contacts: true };
const NO_CONTACTS = { contacts: false };

const person: CrewCounterparty = {
  name: "ИП Иванов Иван Иванович",
  type: "IP",
  contacts: `${PHONE}, ${EMAIL}`,
};
const llc: CrewCounterparty = {
  name: "ООО «Иванов и партнёры»",
  type: "LEGAL_ENTITY",
  contacts: "+7 495 000-00-01, office@example.com",
};

const member: CrewSyncValues = {
  lastName: "Иванов",
  firstName: "Иван",
  middleName: "Иванович",
  phone: PHONE,
  email: EMAIL,
};

describe("counterpartyValues и область полей", () => {
  test("у ООО нет ФИО, только телефон и почта", () => {
    const values = counterpartyValues(llc);
    assert.equal(values.lastName, null);
    assert.equal(values.firstName, null);
    assert.equal(values.phone, "+7 495 000-00-01");
    assert.deepEqual(crewSyncScope("LEGAL_ENTITY", WITH_CONTACTS), ["phone", "email"]);
  });

  test("без права на контакты телефона и почты нет ни в области, ни в снимке", () => {
    assert.deepEqual(crewSyncScope("IP", NO_CONTACTS), ["lastName", "firstName", "middleName"]);
    assert.deepEqual(crewSyncScope("LEGAL_ENTITY", NO_CONTACTS), []);
    const snapshot = pullSnapshot(person, NO_CONTACTS);
    assert.equal("phone" in snapshot, false);
    assert.equal("email" in snapshot, false);
    assert.equal(snapshot.lastName, "Иванов");
  });

  test("снимок читается из любого JSON", () => {
    assert.deepEqual(readCrewSnapshot(null), {});
    assert.deepEqual(readCrewSnapshot([1]), {});
    assert.deepEqual(readCrewSnapshot({ phone: "1", email: null, lastName: 5, extra: "x" }), {
      phone: "1",
      email: null,
    });
  });
});

describe("crewSyncRows: разница относительно снимка", () => {
  const snapshot = pullSnapshot(person, WITH_CONTACTS);

  test("ничего не менялось — строк нет", () => {
    assert.deepEqual(crewSyncRows(member, snapshot, person, WITH_CONTACTS), []);
  });

  test("тот же номер в другом написании — не разница", () => {
    const changed = { ...person, contacts: `8 (900) 111 22 33, ${EMAIL}` };
    assert.deepEqual(crewSyncRows(member, snapshot, changed, WITH_CONTACTS), []);
  });

  test("изменилось в договоре, вручную не трогали — отмечено", () => {
    const changed = { ...person, contacts: `+7 900 999-99-99, ${EMAIL}` };
    const [row, ...rest] = crewSyncRows(member, snapshot, changed, WITH_CONTACTS);
    assert.equal(rest.length, 0);
    assert.equal(row.field, "phone");
    assert.equal(row.current, PHONE);
    assert.equal(row.snapshot, PHONE);
    assert.equal(row.contract, "+7 900 999-99-99");
    assert.equal(row.changedInContract, true);
    assert.equal(row.changedManually, false);
    assert.equal(row.checked, true);
  });

  test("изменено вручную, договор прежний — строка есть, не отмечена", () => {
    const edited = { ...member, firstName: "Ваня" };
    const [row] = crewSyncRows(edited, snapshot, person, WITH_CONTACTS);
    assert.equal(row.field, "firstName");
    assert.equal(row.changedInContract, false);
    assert.equal(row.changedManually, true);
    assert.equal(row.checked, false);
  });

  test("изменили и там, и там — не отмечено", () => {
    const edited = { ...member, phone: "+7 900 888-88-88" };
    const changed = { ...person, contacts: `+7 900 999-99-99, ${EMAIL}` };
    const [row] = crewSyncRows(edited, snapshot, changed, WITH_CONTACTS);
    assert.equal(row.changedInContract, true);
    assert.equal(row.changedManually, true);
    assert.equal(row.checked, false);
  });

  test("поправили одинаково и там, и там — разницы нет", () => {
    const edited = { ...member, phone: "+7 900 999-99-99" };
    const changed = { ...person, contacts: `+7 900 999-99-99, ${EMAIL}` };
    assert.deepEqual(crewSyncRows(edited, snapshot, changed, WITH_CONTACTS), []);
  });

  test("в договоре поле опустело — видно, но не отмечено", () => {
    const changed = { ...person, contacts: EMAIL };
    const [row] = crewSyncRows(member, snapshot, changed, WITH_CONTACTS);
    assert.equal(row.field, "phone");
    assert.equal(row.contract, null);
    assert.equal(row.checked, false);
  });

  test("ручная запись, снимка нет: заполненное не отмечено, пустое отмечено", () => {
    const manual = { ...member, phone: "+7 900 000-00-00", email: null };
    const rows = crewSyncRows(manual, null, person, WITH_CONTACTS);
    assert.equal(rows.find((r) => r.field === "phone")?.checked, false);
    assert.equal(rows.find((r) => r.field === "email")?.checked, true);
  });

  test("запись подтянута без контактов: телефон для того, у кого право есть, — новый и отмечен", () => {
    const blank = { ...member, phone: null, email: null };
    const rows = crewSyncRows(blank, pullSnapshot(person, NO_CONTACTS), person, WITH_CONTACTS);
    assert.deepEqual(rows.map((r) => [r.field, r.checked]), [["phone", true], ["email", true]]);
  });

  test("без права на контакты телефона нет в строках и в ответе", () => {
    const changed = { ...person, contacts: "+7 900 999-99-99, new@example.com" };
    const rows = crewSyncRows(member, snapshot, changed, NO_CONTACTS);
    assert.deepEqual(rows, []);
  });

  test("ООО: ФИО не сравнивается, только телефон и почта", () => {
    const rows = crewSyncRows(member, null, llc, WITH_CONTACTS);
    assert.deepEqual(rows.map((r) => r.field), ["phone", "email"]);
  });

  test("у фамилии из договора нет значения — строки нет: стереть её нельзя", () => {
    const rows = crewSyncRows(member, snapshot, { ...person, name: "ИП" }, WITH_CONTACTS);
    assert.equal(rows.some((r) => r.field === "lastName"), false);
  });
});

describe("crewSyncPlan: что применится", () => {
  const snapshot = pullSnapshot(person, WITH_CONTACTS);
  const changed = { ...person, contacts: "+7 900 999-99-99, new@example.com" };

  test("значения из договора, выбранные поля попадают в снимок, остальные — нет", () => {
    const plan = crewSyncPlan(member, snapshot, changed, WITH_CONTACTS, ["phone"]);
    assert.deepEqual(plan.data, { phone: "+7 900 999-99-99" });
    assert.deepEqual(plan.labels, ["Телефон"]);
    assert.equal(plan.snapshot.phone, "+7 900 999-99-99");
    assert.equal(plan.snapshot.email, EMAIL);
  });

  test("после применения выбранное поле больше не отличается, а отказанное видно снова", () => {
    const plan = crewSyncPlan(member, snapshot, changed, WITH_CONTACTS, ["phone"]);
    const rows = crewSyncRows({ ...member, ...plan.data }, plan.snapshot, changed, WITH_CONTACTS);
    assert.deepEqual(rows.map((r) => r.field), ["email"]);
  });

  test("ручная правка, совпавшая с договором, закрепляется в снимке", () => {
    const edited = { ...member, email: "new@example.com" };
    const plan = crewSyncPlan(edited, snapshot, changed, WITH_CONTACTS, ["phone"]);
    assert.equal(plan.snapshot.email, "new@example.com");
  });

  test("подделанный запрос: без права телефон не применяется и снимок контактов не трогается", () => {
    const plan = crewSyncPlan(member, snapshot, changed, NO_CONTACTS, ["phone", "email"]);
    assert.deepEqual(plan.data, {});
    assert.equal(plan.snapshot.phone, PHONE);
    assert.equal(plan.snapshot.email, EMAIL);
  });

  test("подделанный запрос: ФИО из ООО не применяется", () => {
    const plan = crewSyncPlan(member, null, llc, WITH_CONTACTS, ["lastName", "phone"]);
    assert.deepEqual(Object.keys(plan.data), ["phone"]);
    assert.equal("lastName" in plan.snapshot, false);
  });
});

const crewMember = (over: Partial<CrewMatchRecord>): CrewMatchRecord => ({
  id: "m1",
  lastName: "Иванов",
  firstName: "Иван",
  middleName: null,
  phone: null,
  archivedAt: null,
  ...over,
});

describe("похожие люди", () => {
  const ivanov = { lastName: "Иванов", firstName: "Иван", middleName: "Петрович" };

  test("фамилия совпадает, имя и отчество не спорят; регистр и ё не важны", () => {
    assert.equal(isSimilarCrewName(ivanov, { ...ivanov, middleName: null }), true);
    assert.equal(isSimilarCrewName(ivanov, { ...ivanov, firstName: "И.", middleName: "П." }), true);
    assert.equal(isSimilarCrewName(ivanov, { lastName: "ИВАНОВ", firstName: null, middleName: null }), true);
    assert.equal(
      isSimilarCrewName(
        { lastName: "Семёнов", firstName: null, middleName: null },
        { lastName: "Семенов", firstName: null, middleName: null },
      ),
      true,
    );
  });

  test("другое имя, другая фамилия или пустая фамилия — не похож", () => {
    assert.equal(isSimilarCrewName(ivanov, { ...ivanov, firstName: "Пётр" }), false);
    assert.equal(isSimilarCrewName(ivanov, { ...ivanov, middleName: "Олегович" }), false);
    assert.equal(isSimilarCrewName(ivanov, { ...ivanov, lastName: "Иванова" }), false);
    const empty = { lastName: "", firstName: null, middleName: null };
    assert.equal(isSimilarCrewName(empty, empty), false);
  });

  test("телефон сравнивается только при праве, архив отмечается", () => {
    const candidate = { lastName: "Петров", firstName: null, middleName: null, phone: "8 900 111-22-33" };
    const other = crewMember({ phone: PHONE, archivedAt: new Date() });
    assert.deepEqual(findCrewMatches(candidate, [other], NO_CONTACTS), []);
    assert.deepEqual(findCrewMatches(candidate, [other], WITH_CONTACTS), [
      { id: "m1", name: "Иванов Иван", archived: true },
    ]);
  });
});

describe("suggestCrewDepartment", () => {
  const item = (departmentId: string, date: string) => ({
    date: new Date(date),
    budgetItem: { departmentId },
  });

  test("самый частый; при равенстве — более свежий; без статьи не считается", () => {
    assert.equal(suggestCrewDepartment([]), null);
    assert.equal(suggestCrewDepartment([{ date: new Date(), budgetItem: null }]), null);
    assert.equal(
      suggestCrewDepartment([item("a", "2026-01-01"), item("b", "2026-02-01"), item("a", "2026-01-02")]),
      "a",
    );
    assert.equal(suggestCrewDepartment([item("a", "2026-01-01"), item("b", "2026-02-01")]), "b");
  });
});

describe("toCrewPullCandidate", () => {
  const contract = (
    id: string,
    key: string | null,
    crewLinks: { crewMemberId: string }[] = [],
  ): CrewPullRecord["contracts"][number] => ({
    id,
    number: `№${id}`,
    date: new Date("2026-01-01T00:00:00.000Z"),
    status: { key, name: key ?? "Свой статус", color: "#000000" },
    crewLinks,
    accruals: [],
  });
  const record: CrewPullRecord = { ...person, id: "cp1", contracts: [contract("c1", "UNSIGNED")] };

  test("ФИО разобрано, ИП убрано, контакты при праве", () => {
    const out = toCrewPullCandidate(record, [], WITH_CONTACTS);
    assert.equal(out?.lastName, "Иванов");
    assert.equal(out?.phone, PHONE);
    assert.equal(out?.email, EMAIL);
  });

  test("без права контактов нет даже как ключей и нет сырого текста", () => {
    const out = toCrewPullCandidate(record, [], NO_CONTACTS);
    assert.ok(out);
    assert.equal("phone" in out, false);
    assert.equal("email" in out, false);
    assert.equal("contacts" in out, false);
    assert.equal(JSON.stringify(out).includes(PHONE), false);
    assert.equal(JSON.stringify(out).includes(EMAIL), false);
  });

  test("ООО не показываем", () => {
    assert.equal(toCrewPullCandidate({ ...record, ...llc }, [], WITH_CONTACTS), null);
  });

  test("отклонённые и связанные договоры не показываем, свой статус без ключа показываем", () => {
    const rejectedOnly = { ...record, contracts: [contract("c1", "REJECTED")] };
    assert.equal(toCrewPullCandidate(rejectedOnly, [], WITH_CONTACTS), null);
    const linkedOnly = { ...record, contracts: [contract("c1", null, [{ crewMemberId: "m1" }])] };
    assert.equal(toCrewPullCandidate(linkedOnly, [crewMember({})], WITH_CONTACTS), null);
    const mixed = { ...record, contracts: [contract("c1", "REJECTED"), contract("c2", null)] };
    assert.deepEqual(
      toCrewPullCandidate(mixed, [], WITH_CONTACTS)?.contracts.map((c) => c.id),
      ["c2"],
    );
  });

  test("новый договор контрагента, который уже в команде: человек известен, похожих не ищем", () => {
    const again = {
      ...record,
      contracts: [contract("c1", "UNSIGNED", [{ crewMemberId: "m1" }]), contract("c2", "UNSIGNED")],
    };
    const out = toCrewPullCandidate(again, [crewMember({})], WITH_CONTACTS);
    assert.equal(out?.inTeam?.id, "m1");
    assert.deepEqual(out?.similar, []);
    assert.deepEqual(out?.contracts.map((c) => c.id), ["c2"]);
  });

  test("похожее ФИО предлагается", () => {
    const out = toCrewPullCandidate(record, [crewMember({ id: "m2" })], WITH_CONTACTS);
    assert.equal(out?.inTeam, null);
    assert.deepEqual(out?.similar.map((m) => m.id), ["m2"]);
  });

  test("цех подставляется по начислениям договора", () => {
    const withAccrual = {
      ...record,
      contracts: [
        {
          ...contract("c1", "UNSIGNED"),
          accruals: [{ date: new Date(), budgetItem: { departmentId: "d1" } }],
        },
      ],
    };
    assert.equal(toCrewPullCandidate(withAccrual, [], WITH_CONTACTS)?.departmentId, "d1");
  });
});

describe("основной договор и пометки", () => {
  const signed: CrewRowContract = {
    id: "c1",
    number: "1",
    date: "2026-01-01",
    statusName: "Подписан",
    statusColor: "#000000",
    rejected: false,
  };
  const rejected: CrewRowContract = { ...signed, id: "c2", number: "2", date: "2026-02-01", rejected: true };
  const row = (over: Partial<CrewRow>) => ({ source: "CONTRACT", ...over }) as CrewRow;

  test("основной — первый не отклонённый, а если все отклонены — самый новый", () => {
    assert.equal(crewMainContract([rejected, signed])?.id, "c1");
    assert.equal(crewMainContract([rejected])?.id, "c2");
    assert.equal(crewMainContract([]), undefined);
  });

  test("пометки только у тех, кому видны договоры", () => {
    assert.equal(crewContractMark(row({})), null);
    assert.equal(crewContractMark(row({ contracts: [] })), "deleted");
    assert.equal(crewContractMark(row({ source: "MANUAL", contracts: [] })), null);
    assert.equal(crewContractMark(row({ contracts: [rejected] })), "rejected");
    assert.equal(crewContractMark(row({ contracts: [rejected, signed] })), null);
  });
});
