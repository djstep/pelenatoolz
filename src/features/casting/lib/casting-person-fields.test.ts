import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CASTING_PERSON_FIELDS,
  CASTING_PERSON_INPUT_FIELDS,
} from "@/features/casting/lib/casting-person-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const person = {
  id: "p1",
  projectId: "pr1",
  lastName: "Иванов",
  phone: "+7 900 000-00-00",
  email: "ivanov@example.ru",
  agentName: "Агент",
  agentPhone: "+7 911 111-11-11",
  agentEmail: "agent@example.ru",
  proposedRate: 15000,
  proposedTerms: "без переработок",
  candidates: [{ id: "c1", character: { id: "ch1", name: "Герой" } }],
};

describe("кастинг: кандидат в браузере", () => {
  test("без фин. просмотра актёров нет ставки и условий, контакты остаются", () => {
    const out = pickFinanceFields(person, CASTING_PERSON_FIELDS, false);
    assert.equal("proposedRate" in out, false);
    assert.equal("proposedTerms" in out, false);
    assert.equal(out.phone, person.phone);
    assert.equal(out.email, person.email);
    assert.equal(out.agentPhone, person.agentPhone);
    assert.equal(out.agentEmail, person.agentEmail);
    assert.equal(JSON.stringify(out).includes("15000"), false);
  });

  test("с фин. просмотром ставка и условия есть", () => {
    const out = pickFinanceFields(person, CASTING_PERSON_FIELDS, true);
    assert.equal(out.proposedRate, 15000);
    assert.equal(out.proposedTerms, "без переработок");
  });
});

describe("кастинг: запись формы", () => {
  const input = { lastName: "Иванов", phone: "1", proposedRate: 99999, proposedTerms: "x" };

  test("без фин. правки присланные ставка и условия не пишутся", () => {
    const data = pickFinanceFields(input, CASTING_PERSON_INPUT_FIELDS, false);
    assert.deepEqual(data, { lastName: "Иванов", phone: "1" });
  });

  test("с фин. правкой пишутся", () => {
    const data = pickFinanceFields(input, CASTING_PERSON_INPUT_FIELDS, true);
    assert.equal(data.proposedRate, 99999);
    assert.equal(data.proposedTerms, "x");
  });
});
