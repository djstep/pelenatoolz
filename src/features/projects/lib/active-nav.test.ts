import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NavGroup } from "@/features/projects/components/project-nav";
import { activeSectionTitle, findActiveNavHref } from "@/features/projects/lib/active-nav";

const BASE = "/ru/projects/p1";
const groups: NavGroup[] = [
  { id: "home", items: [{ href: "", label: "Обзор" }, { href: "/screenplay", label: "Сценарий" }] },
  {
    id: "planning",
    title: "Планирование",
    items: [
      { href: "/schedule", label: "КПП" },
      { href: "/schedule/availability", label: "Занятость" },
    ],
  },
  {
    id: "finance",
    title: "Финансы",
    items: [
      { href: "/finance", label: "Операции", exact: true },
      { href: "/finance/reports", label: "Отчёты" },
      { href: "/smeta", label: "Сметы", matchPrefixes: ["/budget"] },
    ],
  },
];
const items = groups.flatMap((g) => g.items);

describe("findActiveNavHref", () => {
  test("обзор — только точный адрес", () => {
    assert.equal(findActiveNavHref(items, BASE, BASE), "");
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/unknown`), null);
  });
  test("самый длинный адрес важнее короткого", () => {
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/schedule/availability`), "/schedule/availability");
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/schedule`), "/schedule");
  });
  test("exact не ловит вложенные адреса", () => {
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/finance/reports`), "/finance/reports");
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/finance/other`), null);
  });
  test("вложенные адреса и matchPrefixes", () => {
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/smeta/d1/review`), "/smeta");
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/budget/x`), "/smeta");
  });
});

describe("activeSectionTitle", () => {
  test("страница раздела — его название", () => {
    assert.equal(activeSectionTitle(groups, BASE, `${BASE}/schedule`), "Планирование");
    assert.equal(activeSectionTitle(groups, BASE, `${BASE}/smeta/d1`), "Финансы");
  });
  test("группа без названия и адрес вне меню — ничего", () => {
    assert.equal(activeSectionTitle(groups, BASE, BASE), null);
    assert.equal(activeSectionTitle(groups, BASE, `${BASE}/screenplay/v1`), null);
    assert.equal(activeSectionTitle(groups, BASE, `${BASE}/unknown`), null);
  });
});
