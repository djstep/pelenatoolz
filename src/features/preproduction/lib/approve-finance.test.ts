import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveApprovedActorFinance,
  resolveApprovedScoutCost,
} from "@/features/preproduction/lib/approve-finance";

const existingActor = { shiftRate: 5000, specialConditions: "без ночных" };
const existingSnapshot = { proposedRate: 4500, proposedTerms: "без ночных", shiftRate: 5000 };
const emptyCandidate = { proposedRate: null, proposedTerms: null };
const filledCandidate = { proposedRate: 7000, proposedTerms: "только дни" };

describe("утверждение кандидата кастинга без фин. правки актёров", () => {
  test("у кандидата заполнено — переносится в актёра и снимок", () => {
    for (const samePerson of [true, false]) {
      const r = resolveApprovedActorFinance({
        canWriteFinance: false,
        samePerson,
        candidate: filledCandidate,
        existingActor,
        existingSnapshot,
      });
      assert.deepEqual(r.actor, { shiftRate: 7000, specialConditions: "только дни" });
      assert.deepEqual(r.snapshot, { proposedRate: 7000, proposedTerms: "только дни", shiftRate: 7000 });
    }
  });

  test("у кандидата пусто, тот же человек — прежние ставка и условия сохраняются", () => {
    const r = resolveApprovedActorFinance({
      canWriteFinance: false,
      samePerson: true,
      candidate: emptyCandidate,
      existingActor,
      existingSnapshot,
    });
    assert.deepEqual(r.actor, existingActor);
    assert.deepEqual(r.snapshot, { proposedRate: 4500, proposedTerms: "без ночных", shiftRate: 5000 });
  });

  test("у кандидата пусто, другой человек — пусто, ставка прежнего не наследуется", () => {
    const r = resolveApprovedActorFinance({
      canWriteFinance: false,
      samePerson: false,
      candidate: emptyCandidate,
      existingActor,
      existingSnapshot,
    });
    assert.deepEqual(r.actor, { shiftRate: null, specialConditions: null });
    assert.deepEqual(r.snapshot, { proposedRate: null, proposedTerms: null, shiftRate: null });
  });

  test("пустая строка условий — это «пусто»; ставка и условия решаются по отдельности", () => {
    const r = resolveApprovedActorFinance({
      canWriteFinance: false,
      samePerson: true,
      candidate: { proposedRate: 6000, proposedTerms: "  " },
      existingActor,
      existingSnapshot,
    });
    assert.deepEqual(r.actor, { shiftRate: 6000, specialConditions: "без ночных" });
  });
});

describe("утверждение кандидата кастинга с фин. правкой актёров — как раньше", () => {
  test("всё как у кандидата, пустое стирает и у того же человека", () => {
    const filled = resolveApprovedActorFinance({
      canWriteFinance: true,
      samePerson: true,
      candidate: filledCandidate,
      existingActor,
      existingSnapshot,
    });
    assert.deepEqual(filled.actor, { shiftRate: 7000, specialConditions: "только дни" });
    const empty = resolveApprovedActorFinance({
      canWriteFinance: true,
      samePerson: true,
      candidate: emptyCandidate,
      existingActor,
      existingSnapshot,
    });
    assert.deepEqual(empty.actor, { shiftRate: null, specialConditions: null });
    assert.deepEqual(empty.snapshot, { proposedRate: null, proposedTerms: null, shiftRate: null });
  });
});

describe("утверждение кандидата скаута без фин. правки объектов", () => {
  test("у кандидата стоимость заполнена — переносится", () => {
    for (const sameCandidate of [true, false]) {
      assert.equal(
        resolveApprovedScoutCost({ canWriteFinance: false, sameCandidate, candidateCost: 30000, existingCost: 25000 }),
        30000,
      );
    }
  });

  test("у кандидата пусто, та же площадка — прежняя стоимость сохраняется", () => {
    assert.equal(
      resolveApprovedScoutCost({ canWriteFinance: false, sameCandidate: true, candidateCost: null, existingCost: 25000 }),
      25000,
    );
  });

  test("у кандидата пусто, другая площадка — пусто, стоимость прежней не наследуется", () => {
    assert.equal(
      resolveApprovedScoutCost({ canWriteFinance: false, sameCandidate: false, candidateCost: null, existingCost: 25000 }),
      null,
    );
  });

  test("с фин. правкой объектов — как у кандидата, пустое стирает", () => {
    assert.equal(
      resolveApprovedScoutCost({ canWriteFinance: true, sameCandidate: true, candidateCost: null, existingCost: 25000 }),
      null,
    );
    assert.equal(
      resolveApprovedScoutCost({ canWriteFinance: true, sameCandidate: false, candidateCost: 30000, existingCost: 25000 }),
      30000,
    );
  });
});
