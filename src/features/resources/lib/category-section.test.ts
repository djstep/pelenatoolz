import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  checkCategorySection,
  NO_RIGHTS,
  SECTION_NOT_FOUND,
  SPECIAL_TRANSPORT_SECTION,
  type CategorySectionDeps,
} from "@/features/resources/lib/category-section";

/** Разделы этого проекта: id → ключ. Запоминает, какие id спрашивали. */
function deps(canEdit: boolean, own: Record<string, string | null> = {}) {
  const asked: string[] = [];
  const value: CategorySectionDeps = {
    canEdit,
    sectionKey: async (id) => {
      asked.push(id);
      return id in own ? own[id] : undefined;
    },
  };
  return { value, asked };
}

const creating = { name: "Реквизит", perShift: false, creating: true };
const editing = { name: "Реквизит", perShift: false, creating: false };

describe("раздел вызывного у категории ресурсов", () => {
  test("без права правки категорий — отказ, база не трогается", async () => {
    const { value, asked } = deps(false, { s1: "PROPS" });
    assert.deepEqual(await checkCategorySection(value, "s1", editing), { error: NO_RIGHTS });
    assert.equal(asked.length, 0);
  });

  test("раздел другого проекта — отказ", async () => {
    const { value } = deps(true, { s1: "PROPS" });
    assert.deepEqual(await checkCategorySection(value, "foreign", editing), {
      error: SECTION_NOT_FOUND,
    });
  });

  test("свой раздел проекта и системный по ключу — проходят", async () => {
    const { value } = deps(true, { own: null, cam: "CAMERA" });
    assert.deepEqual(await checkCategorySection(value, "own", editing), {
      section: { kind: "id", id: "own" },
    });
    assert.deepEqual(await checkCategorySection(value, "cam", editing), {
      section: { kind: "id", id: "cam" },
    });
    assert.deepEqual(await checkCategorySection(value, "key:CG", editing), {
      section: { kind: "key", key: "CG" },
    });
  });

  test("пусто и «Прочее» — без раздела", async () => {
    const { value } = deps(true, { other: "OTHER" });
    assert.deepEqual(await checkCategorySection(value, "", editing), { section: { kind: "none" } });
    assert.deepEqual(await checkCategorySection(value, "key:OTHER", editing), {
      section: { kind: "none" },
    });
    assert.deepEqual(await checkCategorySection(value, "other", editing), {
      section: { kind: "none" },
    });
  });

  test("спецтранспорт выбрать нельзя", async () => {
    const { value } = deps(true, { st: "SPECIAL_TRANSPORT" });
    assert.deepEqual(await checkCategorySection(value, "key:SPECIAL_TRANSPORT", editing), {
      error: SPECIAL_TRANSPORT_SECTION,
    });
    assert.deepEqual(await checkCategorySection(value, "st", editing), {
      error: SPECIAL_TRANSPORT_SECTION,
    });
  });

  test("при создании «auto» — раздел по точному названию, «Пиротехника» — без раздела", async () => {
    const { value } = deps(true);
    assert.deepEqual(await checkCategorySection(value, "auto", creating), {
      section: { kind: "key", key: "PROPS" },
    });
    assert.deepEqual(
      await checkCategorySection(value, "auto", { ...creating, name: "Пиротехника" }),
      { section: { kind: "none" } },
    );
    // Посменная категория — тоже по названию: посменные ресурсы дня идут в элементы площадки.
    assert.deepEqual(
      await checkCategorySection(value, null, { ...creating, name: "Групповка", perShift: true }),
      { section: { kind: "key", key: "GROUP" } },
    );
  });

  test("при правке «auto» не бывает — раздел меняют только руками", async () => {
    const { value } = deps(true);
    assert.deepEqual(await checkCategorySection(value, "auto", editing), {
      error: SECTION_NOT_FOUND,
    });
    assert.deepEqual(await checkCategorySection(value, null, editing), {
      error: SECTION_NOT_FOUND,
    });
  });

  test("неизвестный системный ключ и мусор — отказ", async () => {
    const { value } = deps(true);
    assert.deepEqual(await checkCategorySection(value, "key:NOPE", editing), {
      error: SECTION_NOT_FOUND,
    });
    assert.deepEqual(await checkCategorySection(value, 42, editing), { error: SECTION_NOT_FOUND });
    assert.deepEqual(await checkCategorySection(value, "x".repeat(101), editing), {
      error: SECTION_NOT_FOUND,
    });
  });
});
