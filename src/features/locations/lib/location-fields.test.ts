import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LOCATION_FIELDS,
  SCENE_LOCATION_SELECT,
  SCOUT_SNAPSHOT_FIELDS,
  SCOUT_SNAPSHOT_INPUT_FIELDS,
} from "@/features/locations/lib/location-fields";
import { RESOURCE_ITEM_FIELDS } from "@/features/resources/lib/item-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

describe("карточка объекта", () => {
  const location = {
    id: "l1",
    name: "Квартира",
    address: "ул. Ленина, 1",
    shiftRate: 30000,
    taxPercent: 6,
    overtimeRates: [{ hourNumber: 1, amount: 3000 }],
    defaultBudgetItemId: "b1",
  };

  test("без фин. просмотра объектов нет ставки и переработок", () => {
    assert.deepEqual(pickFinanceFields(location, LOCATION_FIELDS, false), {
      id: "l1",
      name: "Квартира",
      address: "ул. Ленина, 1",
    });
  });

  test("с фин. просмотром ставка есть", () => {
    assert.equal(pickFinanceFields(location, LOCATION_FIELDS, true).shiftRate, 30000);
  });

  test("стоимость площадки в снимке скаута — по тому же праву, запись — с фин. правкой", () => {
    const snap = { title: "Квартира", address: "ул. Ленина, 1", cost: 50000 };
    assert.equal("cost" in pickFinanceFields(snap, SCOUT_SNAPSHOT_FIELDS, false), false);
    assert.equal(pickFinanceFields(snap, SCOUT_SNAPSHOT_FIELDS, true).cost, 50000);
    const input = { address: "новый", cost: 1 };
    assert.deepEqual(pickFinanceFields(input, SCOUT_SNAPSHOT_INPUT_FIELDS, false), {
      address: "новый",
    });
  });
});

describe("карточка ресурса", () => {
  const item = {
    id: "i1",
    categoryId: "cat1",
    name: "Камера",
    shiftRate: 8000,
    kmRate: 40,
    extraPayments: [{ amount: 100 }],
    sceneCount: 3,
  };

  test("без фин. просмотра категории нет ставки, км и доплат", () => {
    assert.deepEqual(pickFinanceFields(item, RESOURCE_ITEM_FIELDS, false), {
      id: "i1",
      categoryId: "cat1",
      name: "Камера",
      sceneCount: 3,
    });
  });

  test("с фин. просмотром есть", () => {
    const out = pickFinanceFields(item, RESOURCE_ITEM_FIELDS, true);
    assert.equal(out.shiftRate, 8000);
    assert.equal(out.kmRate, 40);
  });
});

describe("объект в сценах (либретто, КПП, вызывной)", () => {
  const keys = Object.keys(SCENE_LOCATION_SELECT);

  test("из базы берутся только открытые поля объекта", () => {
    const open: readonly string[] = LOCATION_FIELDS.open;
    for (const key of keys) assert.ok(open.includes(key), key);
  });

  test("ни одного фин. поля и нет снимка скаута со стоимостью", () => {
    const finance: readonly string[] = LOCATION_FIELDS.finance;
    assert.deepEqual(keys.filter((key) => finance.includes(key)), []);
    assert.equal(keys.includes("scoutSnapshot"), false);
  });

  test("название и вид объекта есть — по ним работают сцены и фильтры либретто", () => {
    for (const key of ["id", "name", "sublocation", "locationKind", "address"]) {
      assert.ok(keys.includes(key), key);
    }
  });
});
