import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatPlaceCell } from "@/features/script/lib/libretto-display";

// «Место» в либретто (волна feat/sub-objects, шаг 6): реальные адреса мест сцены.
const house = { id: "h", name: "ДОМ", address: "ул. Лесная, 1", latitude: null, longitude: null };
const sub = (id: string, name: string, address: string | null) => ({
  location: { id, name, address, parent: house },
});

describe("колонка «Место»", () => {
  test("подобъекты без своего адреса — адрес объекта, без повторов", () => {
    const scene = { locations: [sub("k", "ДЕТСКАЯ", null), sub("c", "КОРИДОР", null)] };
    assert.equal(formatPlaceCell(scene as never), "ул. Лесная, 1");
  });

  test("подобъект со своим адресом — его адрес рядом с адресом объекта", () => {
    const scene = { locations: [sub("k", "ДЕТСКАЯ", null), sub("p", "КУХНЯ", "Павильон 3")] };
    assert.equal(formatPlaceCell(scene as never), "ул. Лесная, 1; Павильон 3");
  });

  test("мест нет — прочерк", () => {
    assert.equal(formatPlaceCell({ locations: [] } as never), "—");
  });
});
