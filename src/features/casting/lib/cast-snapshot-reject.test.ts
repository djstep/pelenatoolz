import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CastingCandidateStatus } from "@prisma/client";
import {
  castSnapshotClearedAuditMeta,
  clearCastSnapshotAudited,
  shouldClearCastSnapshot,
} from "@/features/casting/lib/cast-snapshot-reject";
import type { auditMutation } from "@/shared/audit/with-audit";

const { APPROVED, CONSIDERING, REJECTED, RESERVE } = CastingCandidateStatus;

/** Как auditMutation: действие бросило ошибку — записи нет. */
function fakeAudit(log: unknown[]) {
  return (async (_ctx, fn, input, meta) => {
    const result = await fn(input);
    log.push(meta);
    return result;
  }) as typeof auditMutation;
}

/** Персонаж со снимком и смена статуса заявки — тот же порядок, что в действии. */
function setup(snapshotCandidateId: string | null) {
  const character = { snapshotCandidateId };
  const log: unknown[] = [];
  async function changeStatus(candidateId: string, from: CastingCandidateStatus, to: CastingCandidateStatus) {
    if (!shouldClearCastSnapshot(to, candidateId, character.snapshotCandidateId)) return;
    await clearCastSnapshotAudited(
      { user: { id: "u1" } },
      castSnapshotClearedAuditMeta({
        projectId: "p1",
        candidateId,
        characterId: "ch1",
        characterName: "Роль",
        personName: "Иванов Иван",
        previousStatus: from,
      }),
      async () => {
        if (character.snapshotCandidateId !== candidateId) return 0;
        character.snapshotCandidateId = null;
        return 1;
      },
      fakeAudit(log),
    );
  }
  return { character, log, changeStatus };
}

describe("«Отказ» снимает снимок у персонажа", () => {
  test("Утверждён → Рассматривается → Отказ: снимок снят на «Отказе», одна запись", async () => {
    const s = setup("a");
    await s.changeStatus("a", APPROVED, CONSIDERING);
    assert.equal(s.character.snapshotCandidateId, "a");
    assert.equal(s.log.length, 0);
    await s.changeStatus("a", CONSIDERING, REJECTED);
    assert.equal(s.character.snapshotCandidateId, null);
    assert.equal(s.log.length, 1);
  });

  test("Утверждён → Отказ — как раньше", async () => {
    const s = setup("a");
    await s.changeStatus("a", APPROVED, REJECTED);
    assert.equal(s.character.snapshotCandidateId, null);
    assert.equal(s.log.length, 1);
  });

  test("«Отказ» другой заявки на ту же роль снимок утверждённого не трогает", async () => {
    const s = setup("a");
    await s.changeStatus("b", CONSIDERING, REJECTED);
    assert.equal(s.character.snapshotCandidateId, "a");
    assert.equal(s.log.length, 0);
  });

  test("обычная смена статуса — снимок на месте, записи нет", async () => {
    const s = setup("a");
    await s.changeStatus("a", APPROVED, RESERVE);
    await s.changeStatus("a", RESERVE, CONSIDERING);
    assert.equal(s.character.snapshotCandidateId, "a");
    assert.equal(s.log.length, 0);
  });

  test("снимать было нечего (снимок уже снят) — записи нет", async () => {
    const log: unknown[] = [];
    const cleared = await clearCastSnapshotAudited(
      { user: { id: "u1" } },
      castSnapshotClearedAuditMeta({
        projectId: "p1",
        candidateId: "a",
        characterId: "ch1",
        characterName: "Роль",
        personName: "Иванов Иван",
        previousStatus: CONSIDERING,
      }),
      async () => 0,
      fakeAudit(log),
    );
    assert.equal(cleared, false);
    assert.equal(log.length, 0);
  });

  test("запись: текст, id заявки и персонажа, статусы — без контактов и ставки", () => {
    const meta = castSnapshotClearedAuditMeta({
      projectId: "p1",
      candidateId: "a",
      characterId: "ch1",
      characterName: "Роль",
      personName: "Иванов Иван",
      previousStatus: CONSIDERING,
    });
    assert.equal(meta.entityType, "casting_candidate");
    assert.equal(meta.action, "UPDATE");
    assert.equal(meta.entityId, "a");
    assert.equal(
      meta.summary,
      "Заявка «Иванов Иван» на роль «Роль»: статус «Отказ», снят снимок кандидата у персонажа",
    );
    assert.deepEqual(meta.changes, {
      candidateId: "a",
      characterId: "ch1",
      status: { from: "CONSIDERING", to: "REJECTED" },
    });
  });
});
