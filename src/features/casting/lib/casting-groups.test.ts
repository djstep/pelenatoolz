import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CASTING_FILTER_NO_CHARACTER,
  countCastingPeople,
  groupCastingPeople,
  resolveCastingFilter,
} from "@/features/casting/lib/casting-groups";

const anna = { id: "c-anna", name: "АННА" };
const boris = { id: "c-boris", name: "БОРИС" };
const vera = { id: "c-vera", name: "ВЕРА" };
const characters = [anna, boris, vera];

const both = {
  id: "p-both",
  candidates: [
    { id: "k-both-boris", character: boris },
    { id: "k-both-anna", character: anna },
  ],
};
const onlyAnna = {
  id: "p-anna",
  candidates: [{ id: "k-anna", character: anna }],
};
const noRoles = { id: "p-none", candidates: [] };
const people = [both, onlyAnna, noRoles];

describe("groupCastingPeople", () => {
  test("группы только у персонажей с кандидатами, в порядке списка персонажей", () => {
    const { groups, charactersWithoutCandidates } = groupCastingPeople(
      people,
      characters,
    );
    assert.deepEqual(
      groups.map((g) => g.key),
      [anna.id, boris.id, CASTING_FILTER_NO_CHARACTER],
    );
    assert.deepEqual(charactersWithoutCandidates, [vera]);
  });

  test("человек на две роли — в обеих группах, со своей заявкой и пометкой о другой роли", () => {
    const { groups } = groupCastingPeople(people, characters);
    const annaRow = groups[0].rows.find((r) => r.person.id === both.id);
    const borisRow = groups[1].rows.find((r) => r.person.id === both.id);
    assert.equal(annaRow?.candidate?.id, "k-both-anna");
    assert.deepEqual(annaRow?.otherRoles, ["БОРИС"]);
    assert.equal(borisRow?.candidate?.id, "k-both-boris");
    assert.deepEqual(borisRow?.otherRoles, ["АННА"]);
  });

  test("порядок людей в группе — как в списке людей", () => {
    const { groups } = groupCastingPeople(people, characters);
    assert.deepEqual(
      groups[0].rows.map((r) => r.person.id),
      [both.id, onlyAnna.id],
    );
  });

  test("люди без заявок — последней группой «Без персонажа»", () => {
    const { groups } = groupCastingPeople(people, characters);
    const last = groups[groups.length - 1];
    assert.equal(last.character, null);
    assert.deepEqual(
      last.rows.map((r) => [r.person.id, r.candidate, r.otherRoles]),
      [[noRoles.id, null, []]],
    );
  });

  test("без людей без заявок группы «Без персонажа» нет", () => {
    const { groups } = groupCastingPeople([both, onlyAnna], characters);
    assert.equal(
      groups.some((g) => g.key === CASTING_FILTER_NO_CHARACTER),
      false,
    );
  });

  test("пусто — ни групп, все персонажи без кандидатов", () => {
    const { groups, charactersWithoutCandidates } = groupCastingPeople(
      [],
      characters,
    );
    assert.deepEqual(groups, []);
    assert.deepEqual(charactersWithoutCandidates, characters);
  });
});

describe("resolveCastingFilter", () => {
  const { groups } = groupCastingPeople(people, characters);

  test("персонаж с кандидатами и «Без персонажа» — принимаются", () => {
    assert.equal(resolveCastingFilter(anna.id, groups), anna.id);
    assert.equal(
      resolveCastingFilter(CASTING_FILTER_NO_CHARACTER, groups),
      CASTING_FILTER_NO_CHARACTER,
    );
  });

  test("пусто, неизвестный или чужой id, персонаж без кандидатов — «Все»", () => {
    assert.equal(resolveCastingFilter(undefined, groups), null);
    assert.equal(resolveCastingFilter("", groups), null);
    assert.equal(resolveCastingFilter("c-foreign", groups), null);
    assert.equal(resolveCastingFilter(vera.id, groups), null);
  });

  test("«Без персонажа» без таких людей — «Все»", () => {
    const only = groupCastingPeople([onlyAnna], characters).groups;
    assert.equal(resolveCastingFilter(CASTING_FILTER_NO_CHARACTER, only), null);
  });
});

describe("countCastingPeople", () => {
  const { groups } = groupCastingPeople(people, characters);

  test("все группы — уникальные люди, не строки", () => {
    assert.equal(countCastingPeople(groups), 3);
  });

  test("одна группа — люди этой группы", () => {
    assert.equal(countCastingPeople(groups.filter((g) => g.key === anna.id)), 2);
    assert.equal(
      countCastingPeople(groups.filter((g) => g.key === boris.id)),
      1,
    );
  });
});
