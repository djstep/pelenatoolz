import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteProjectRefusal,
  lockProjectOwner,
  memberChangeRefusal,
  OWNER_ONLY_DELETE_ERROR,
  OWNER_ONLY_TRANSFER_ERROR,
  OWNER_PROTECTED_ERROR,
  projectCreatedAuditMeta,
  TRANSFER_TO_PRODUCER_ERROR,
  transferRefusal,
} from "./owner";

function fakeTx(rows: { ownerUserId: string }[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { tx: { $queryRaw } as unknown as Parameters<typeof lockProjectOwner>[0], calls };
}

const OWNER = "u-owner";
const PRODUCER = "u-producer";
const VIEWER = "u-viewer";

describe("lockProjectOwner", () => {
  it("блокирует строку проекта и возвращает владельца", async () => {
    const { tx, calls } = fakeTx([{ ownerUserId: "u1" }]);
    assert.equal(await lockProjectOwner(tx, "p1"), "u1");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.sql, /FROM "Project" WHERE "id" = \? FOR UPDATE/);
    assert.deepEqual(calls[0]!.values, ["p1"]);
  });

  it("нет проекта — null", async () => {
    const { tx } = fakeTx([]);
    assert.equal(await lockProjectOwner(tx, "p1"), null);
  });

  it("текст отказа — как в ТЗ", () => {
    assert.equal(OWNER_PROTECTED_ERROR, "Это владелец проекта — сначала передайте владение");
  });
});

describe("владельца нельзя понизить или удалить", () => {
  it("смена роли или удаление владельца — отказ", () => {
    assert.equal(memberChangeRefusal(OWNER, OWNER), OWNER_PROTECTED_ERROR);
  });

  it("другого участника — можно", () => {
    assert.equal(memberChangeRefusal(PRODUCER, OWNER), null);
    assert.equal(memberChangeRefusal(VIEWER, OWNER), null);
  });
});

describe("передача владения", () => {
  it("только владелец", () => {
    assert.equal(
      transferRefusal({
        actorUserId: PRODUCER,
        ownerUserId: OWNER,
        target: { userId: VIEWER, isProducer: true },
      }),
      OWNER_ONLY_TRANSFER_ERROR,
    );
  });

  it("только продюсеру", () => {
    assert.equal(
      transferRefusal({
        actorUserId: OWNER,
        ownerUserId: OWNER,
        target: { userId: VIEWER, isProducer: false },
      }),
      TRANSFER_TO_PRODUCER_ERROR,
    );
  });

  it("не себе и не несуществующему участнику", () => {
    assert.equal(
      transferRefusal({
        actorUserId: OWNER,
        ownerUserId: OWNER,
        target: { userId: OWNER, isProducer: true },
      }),
      "Вы уже владелец проекта",
    );
    assert.equal(
      transferRefusal({ actorUserId: OWNER, ownerUserId: OWNER, target: null }),
      "Участник не найден",
    );
  });

  it("владелец → продюсер: можно", () => {
    assert.equal(
      transferRefusal({
        actorUserId: OWNER,
        ownerUserId: OWNER,
        target: { userId: PRODUCER, isProducer: true },
      }),
      null,
    );
  });

  it("после передачи бывшего владельца можно понизить, нового — нельзя", () => {
    const newOwner = PRODUCER;
    assert.equal(memberChangeRefusal(OWNER, newOwner), null);
    assert.equal(memberChangeRefusal(PRODUCER, newOwner), OWNER_PROTECTED_ERROR);
    // И передавать дальше может только новый владелец.
    assert.equal(
      transferRefusal({
        actorUserId: OWNER,
        ownerUserId: newOwner,
        target: { userId: OWNER, isProducer: true },
      }),
      OWNER_ONLY_TRANSFER_ERROR,
    );
  });
});

describe("удаление проекта", () => {
  it("только владелец", () => {
    assert.equal(deleteProjectRefusal(OWNER, OWNER), null);
    assert.equal(deleteProjectRefusal(PRODUCER, OWNER), OWNER_ONLY_DELETE_ERROR);
  });

  it("владелец неизвестен — отказ всем", () => {
    assert.equal(deleteProjectRefusal(OWNER, null), OWNER_ONLY_DELETE_ERROR);
  });
});

describe("запись журнала о создании проекта", () => {
  const base = {
    projectId: "p1",
    projectName: "ТЕСТ журнал",
    ownerUserId: OWNER,
    roleId: "r1",
    roleName: "Продюсер",
  };

  it("тип «Проект», действие CREATE, текст как в ТЗ", () => {
    const meta = projectCreatedAuditMeta({ ...base, ownerName: "Степа" });
    assert.equal(meta.entityType, "project");
    assert.equal(meta.action, "CREATE");
    assert.equal(meta.entityId, "p1");
    assert.equal(meta.projectId, "p1");
    assert.equal(
      meta.summary,
      "Проект «ТЕСТ журнал» создан, владелец «Степа», роль «Продюсер»",
    );
  });

  it("пустое имя — «Без имени», почты нет", () => {
    const meta = projectCreatedAuditMeta({ ...base, ownerName: "  " });
    assert.match(String(meta.summary), /владелец «Без имени»/);
    const text = JSON.stringify(meta);
    assert.doesNotMatch(text, /@/);
    assert.doesNotMatch(text, /email/i);
  });
});
