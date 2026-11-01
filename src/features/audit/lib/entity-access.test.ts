import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAuditLogWhere } from "@/features/audit/lib/audit-where";
import {
  stripHiddenFinanceFields,
  visibleAuditEntityTypes,
  type AuditViewer,
} from "@/features/audit/lib/entity-access";
import { hasPermission } from "@/features/memberships/permissions";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildViewerMatrix,
  canEntityFinance,
  canReadAnyEntityFinance,
  type PermissionMatrix,
  type PermissionSectionId,
} from "@/features/roles/permissions-matrix";
import { AuditEntityType } from "@/shared/audit/entity-types";

function viewer(matrix: PermissionMatrix, isProducer = false): AuditViewer {
  return {
    can: (p) => hasPermission(matrix, p),
    matrix,
    isProducer,
    headDepartmentIds: [],
    anyEntityFinanceRead: canReadAnyEntityFinance(matrix, {}),
    canFinanceRead: (target) => canEntityFinance(matrix, {}, target, "read"),
  };
}

/** Только просмотр указанных разделов, без фин. условий. */
function readOnly(...sections: PermissionSectionId[]): PermissionMatrix {
  const matrix = buildEmptyMatrix();
  for (const id of sections) {
    matrix[id] = { ...matrix[id], access: true, read: true };
  }
  return matrix;
}

const ALL_TYPES = Object.values(AuditEntityType);

describe("visibleAuditEntityTypes", () => {
  test("продюсер — без ограничения (видит и неизвестные типы)", () => {
    assert.equal(visibleAuditEntityTypes(viewer(buildFullMatrix(), true)), null);
  });

  test("у каждого типа записи есть условие: полная матрица не-продюсера видит все", () => {
    const visible = visibleAuditEntityTypes(viewer(buildFullMatrix()));
    assert.ok(visible);
    for (const type of ALL_TYPES) assert.ok(visible.includes(type), type);
  });

  test("неизвестный тип не-продюсеру не виден", () => {
    const visible = visibleAuditEntityTypes(viewer(buildFullMatrix()));
    assert.ok(visible && !visible.includes("some_new_type"));
  });

  test("без прав — ничего", () => {
    assert.deepEqual(visibleAuditEntityTypes(viewer(buildEmptyMatrix())), []);
  });

  test("только «Участники» — роли, участие, приглашения", () => {
    const visible = visibleAuditEntityTypes(viewer(readOnly("members")));
    assert.deepEqual(
      [...(visible ?? [])].sort(),
      [AuditEntityType.invite, AuditEntityType.membership, AuditEntityType.role].sort(),
    );
  });

  test("сцены без финансов и договоров — нет финансовых записей", () => {
    const visible = visibleAuditEntityTypes(viewer(readOnly("scenes"))) ?? [];
    assert.ok(visible.includes(AuditEntityType.scene));
    assert.ok(visible.includes(AuditEntityType.resourceItem));
    for (const type of [
      AuditEntityType.financeOp,
      AuditEntityType.accrual,
      AuditEntityType.cashPayment,
      AuditEntityType.contract,
      AuditEntityType.counterparty,
      AuditEntityType.approvalStatus,
      AuditEntityType.budget,
      AuditEntityType.character,
      AuditEntityType.membership,
    ]) {
      assert.ok(!visible.includes(type), type);
    }
  });

  test("«Наблюдатель»: сметы и цеха не видны", () => {
    const visible = visibleAuditEntityTypes(viewer(buildViewerMatrix())) ?? [];
    assert.ok(visible.includes(AuditEntityType.financeOp));
    assert.ok(!visible.includes(AuditEntityType.budget));
    assert.ok(!visible.includes(AuditEntityType.smetaExport));
    assert.ok(!visible.includes(AuditEntityType.department));
  });

  test("старые типы — как КПП", () => {
    const visible = visibleAuditEntityTypes(viewer(readOnly("schedule"))) ?? [];
    assert.ok(visible.includes("ShootDay"));
    assert.ok(visible.includes("shoot_day_scene"));
  });
});

describe("stripHiddenFinanceFields", () => {
  const defaults = { before: { defaultBudgetItemId: "a" }, after: { defaultBudgetItemId: "b" } };

  test("актёр: статьи сметы скрыты без фин. просмотра актёров, без них changes пусты", () => {
    const noFinance = viewer(readOnly("actors"));
    assert.equal(stripHiddenFinanceFields(AuditEntityType.actor, defaults, noFinance), null);

    const matrix = readOnly("actors");
    matrix.actors.financeRead = true;
    assert.deepEqual(
      stripHiddenFinanceFields(AuditEntityType.actor, defaults, viewer(matrix)),
      defaults,
    );
  });

  test("локация: по фин. просмотру объектов", () => {
    const matrix = readOnly("scenes", "locations");
    assert.equal(stripHiddenFinanceFields(AuditEntityType.location, defaults, viewer(matrix)), null);
    matrix.locations.financeRead = true;
    assert.deepEqual(
      stripHiddenFinanceFields(AuditEntityType.location, defaults, viewer(matrix)),
      defaults,
    );
  });

  test("ресурс: по категории; ресурс удалён (нет категории) — скрыто", () => {
    const matrix = readOnly("scenes", "elements");
    matrix.elements.financeRead = true;
    const v = viewer(matrix);
    assert.deepEqual(
      stripHiddenFinanceFields(AuditEntityType.resourceItem, defaults, v, { categoryId: "c1" }),
      defaults,
    );
    assert.equal(
      stripHiddenFinanceFields(AuditEntityType.resourceItem, defaults, v, { categoryId: null }),
      null,
    );
  });

  test("отчёт смены: rateChanges только с finance:read, остальное остаётся", () => {
    const changes = { added: ["Иванов"], removed: [], rateChanges: [{ pay: { before: "1", after: "2" } }] };
    assert.deepEqual(
      stripHiddenFinanceFields(AuditEntityType.productionReport, changes, viewer(readOnly("reports"))),
      { added: ["Иванов"], removed: [] },
    );
    const matrix = readOnly("reports");
    matrix.finance = { ...matrix.finance, access: true, financeRead: true };
    assert.deepEqual(
      stripHiddenFinanceFields(AuditEntityType.productionReport, changes, viewer(matrix)),
      changes,
    );
  });

  test("фин. поле внутри fields тоже убирается", () => {
    const changes = { fields: { rateChanges: { from: 1, to: 2 }, name: { from: "a", to: "b" } } };
    assert.deepEqual(
      stripHiddenFinanceFields(AuditEntityType.productionReport, changes, viewer(readOnly("reports"))),
      { fields: { name: { from: "a", to: "b" } } },
    );
  });

  test("типы без фин. полей не меняются", () => {
    const changes = { roleName: { from: "A", to: "B" } };
    assert.equal(
      stripHiddenFinanceFields(AuditEntityType.membership, changes, viewer(buildEmptyMatrix())),
      changes,
    );
  });
});

describe("buildAuditLogWhere", () => {
  const visible = [AuditEntityType.actor, AuditEntityType.scene];

  test("поиск — только по тексту записи, changes не участвуют", () => {
    const where = buildAuditLogWhere("p1", { search: " 5000 " }, visible);
    assert.deepEqual(where, {
      projectId: "p1",
      entityType: { in: visible },
      summary: { contains: "5000", mode: "insensitive" },
    });
    assert.ok(!JSON.stringify(where).includes("changes"));
  });

  test("фильтр по невидимому типу ничего не находит", () => {
    const where = buildAuditLogWhere("p1", { entityType: AuditEntityType.financeOp }, visible);
    assert.deepEqual(where.entityType, { in: [] });
  });

  test("фильтр по видимому типу — этот тип", () => {
    const where = buildAuditLogWhere("p1", { entityType: AuditEntityType.scene }, visible);
    assert.equal(where.entityType, AuditEntityType.scene);
  });

  test("продюсер — без ограничения по типам", () => {
    assert.deepEqual(buildAuditLogWhere("p1", {}, null), { projectId: "p1" });
  });
});
