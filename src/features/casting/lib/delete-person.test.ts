import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CastingCandidateStatus } from "@prisma/client";
import {
  castingPersonDeleteLines,
  castingPersonDeleteRefusal,
  splitPersonAuditions,
} from "@/features/casting/lib/delete-person";

const { APPROVED, CONSIDERING, REJECTED } = CastingCandidateStatus;

describe("castingPersonDeleteRefusal", () => {
  test("заявка утверждена — отказ с ролью и действием", () => {
    assert.equal(
      castingPersonDeleteRefusal(
        [
          { id: "a", status: CONSIDERING, characterName: "Мать" },
          { id: "b", status: APPROVED, characterName: "Отец" },
        ],
        [{ name: "Отец", sourceCastingCandidateId: "b" }],
      ),
      "Кандидат утверждён на роль «Отец». Чтобы удалить, поставьте заявке на «Отец» статус «Отказ»",
    );
  });

  test("утверждение снято, а снимок у персонажа остался — отказ про снимок", () => {
    assert.equal(
      castingPersonDeleteRefusal(
        [{ id: "a", status: CONSIDERING, characterName: "Мать" }],
        [{ name: "Мать", sourceCastingCandidateId: "a" }],
      ),
      "Персонаж «Мать» хранит снимок этого кандидата. Чтобы удалить, поставьте заявке на «Мать» статус «Отказ»",
    );
  });

  test("не утверждён и снимка нет — можно удалить", () => {
    assert.equal(
      castingPersonDeleteRefusal(
        [
          { id: "a", status: CONSIDERING, characterName: "Мать" },
          { id: "b", status: REJECTED, characterName: "Отец" },
        ],
        [],
      ),
      null,
    );
    assert.equal(castingPersonDeleteRefusal([], []), null);
  });

  test("снимок другой заявки не мешает", () => {
    assert.equal(
      castingPersonDeleteRefusal(
        [{ id: "a", status: REJECTED, characterName: "Мать" }],
        [{ name: "Мать", sourceCastingCandidateId: "other" }],
      ),
      null,
    );
  });
});

describe("splitPersonAuditions", () => {
  test("одиночные удаляются, общие остаются", () => {
    assert.deepEqual(
      splitPersonAuditions([
        { id: "solo", actorCount: 1 },
        { id: "pair", actorCount: 2 },
        { id: "group", actorCount: 4 },
      ]),
      { soloIds: ["solo"], sharedCount: 2 },
    );
  });
});

describe("castingPersonDeleteLines", () => {
  test("строки окна — только ненулевые, про видео — как решено", () => {
    assert.deepEqual(
      castingPersonDeleteLines({
        applications: 2,
        comments: 1,
        scheduleSlots: 0,
        auditionsDeleted: 1,
        auditionsLeft: 1,
        availabilityRows: 0,
      }),
      [
        "Удалятся заявки на роли: 2",
        "Удалятся комментарии к заявкам: 1",
        "Удалятся пробы: 1 (видео останутся в «Файлах проекта»)",
        "Кандидат уберётся из проб с другими участниками: 1",
      ],
    );
  });
});
