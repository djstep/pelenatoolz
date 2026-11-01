import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  SCOUT_CANDIDATE_FIELDS,
  SCOUT_CANDIDATE_INPUT_FIELDS,
} from "@/features/scout/lib/scout-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const candidate = {
  id: "s1",
  title: "Квартира на Ленина",
  address: "ул. Ленина, 1",
  cost: 50000,
  contactName: "Иван",
  contactPhone: "+7 900 000-00-00",
  status: "CONSIDERING",
  locationLinks: [{ locationId: "l1" }],
};

describe("кандидат скаута: стоимость площадки", () => {
  test("без фин. просмотра объектов стоимости нет совсем, контакты остаются", () => {
    const out = pickFinanceFields(candidate, SCOUT_CANDIDATE_FIELDS, false);
    assert.equal("cost" in out, false);
    assert.equal(JSON.stringify(out).includes("50000"), false);
    assert.equal(out.contactPhone, "+7 900 000-00-00");
    assert.deepEqual(out.locationLinks, [{ locationId: "l1" }]);
  });

  test("с фин. просмотром объектов стоимость есть", () => {
    assert.equal(pickFinanceFields(candidate, SCOUT_CANDIDATE_FIELDS, true).cost, 50000);
  });

  test("запись: без фин. правки присланная стоимость отбрасывается", () => {
    const input = { locationIds: ["l1"], title: "Новое", cost: "99999" };
    assert.deepEqual(pickFinanceFields(input, SCOUT_CANDIDATE_INPUT_FIELDS, false), {
      locationIds: ["l1"],
      title: "Новое",
    });
    assert.equal(pickFinanceFields(input, SCOUT_CANDIDATE_INPUT_FIELDS, true).cost, "99999");
  });
});
