import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

/**
 * Настоящие серверные действия с подменённой базой: что уходит на запись, когда поле стёрли.
 * undefined — «не менять», null — «очистить».
 */

type Call = { model: string; method: string; args: { data?: Record<string, unknown> } };

const PROJECT = "cmproject000000000000000a";
const ID = "cmrecord0000000000000000a";
const LOCATION = "cmlocation00000000000000a";

let calls: Call[] = [];
let rows: Record<string, unknown> = {};
let canFinance = true;

const model = (name: string) =>
  new Proxy(
    {},
    {
      get: (_, method: string) => async (args: Call["args"]) => {
        if (method.startsWith("find")) return rows[name] ?? null;
        if (method === "count") return rows[`${name}Count`] ?? 0;
        calls.push({ model: name, method, args });
        return { id: ID, count: 1, version: 1 };
      },
    },
  );

const prisma: object = new Proxy(
  {},
  {
    get: (_, name: string) =>
      name === "$transaction"
        ? async (work: unknown) =>
            typeof work === "function" ? work(prisma) : Promise.all(work as Promise<unknown>[])
        : model(name),
  },
);

const ctx = {
  can: () => true,
  canFinanceWrite: () => canFinance,
  user: { id: "user" },
  membership: { roleId: "other" },
  project: { ownerUserId: "owner" },
  role: { permissions: {} },
};

mock.module("@/shared/db/prisma", { namedExports: { prisma } });
mock.module("@/features/projects/lib/project-context", {
  namedExports: { requireProjectContext: async () => ctx },
});
mock.module("@/features/auth/session", {
  namedExports: { requireUser: async () => ({ id: "user" }) },
});
mock.module("@/features/memberships/queries", {
  namedExports: {
    requireProjectAccess: async () => ({}),
    listProjectRoles: async () => [],
  },
});
mock.module("@/features/projects/lib/owner", {
  namedExports: { isOwnerRole: async () => false, OWNER_ROLE_ERROR: "" },
});
mock.module("@/features/cloud/lib/drive-access-sync", {
  namedExports: { scheduleProjectDriveAccessSync: () => {} },
});
// Пересчёт смет после смены параметров проекта проверяется отдельно (e2e c32).
mock.module("@/features/smeta/items-recalc", {
  namedExports: { recalcItemsAfterVariables: async () => 0, revalidateSmetaPages: () => {} },
});
mock.module("server-only", { namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", { namedExports: { redirect: () => {} } });

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(key, item);
  }
  return data;
}

function written(name: string) {
  const call = calls.find((c) => c.model === name);
  assert.ok(call, `нет записи в ${name}`);
  return call.args.data as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  rows = {};
  canFinance = true;
});

describe("настройки проекта", () => {
  it("стёртые поля очищаются, отсутствующие не меняются", async () => {
    const { updateProjectAction } = await import("@/features/projects/actions");
    const result = await updateProjectAction(
      PROJECT,
      {},
      form({
        name: "Проект",
        type: "FEATURE",
        description: "",
        fullName: "",
        city: "",
        startDate: "",
        endDate: "",
        shootingDaysCount: "",
        cameraUnits: "",
        cameraCount: "",
        plannedDailyOutputMin: "",
        filmType: "",
        filmCoefficient: "",
      }),
    );
    assert.equal(result.error, undefined);
    const data = written("project");
    for (const field of [
      "description",
      "fullName",
      "city",
      "startDate",
      "endDate",
      "shootingDaysCount",
      "cameraUnits",
      "cameraCount",
      "plannedDailyOutputMin",
      "filmType",
      "filmCoefficient",
    ]) {
      assert.equal(data[field], null, field);
    }
    assert.equal(data.name, "Проект");
  });

  it("обязательное поле со значением по умолчанию не обнуляется", async () => {
    const { updateProjectAction } = await import("@/features/projects/actions");
    await updateProjectAction(PROJECT, {}, form({ name: "Проект", currency: "", timezone: "" }));
    const data = written("project");
    assert.equal(data.currency, undefined);
    assert.equal(data.timezone, undefined);
  });

  it("дата сохраняется датой", async () => {
    const { updateProjectAction } = await import("@/features/projects/actions");
    await updateProjectAction(PROJECT, {}, form({ name: "Проект", startDate: "2026-03-01" }));
    assert.ok(written("project").startDate instanceof Date);
    assert.equal(written("project").endDate, undefined);
  });

  it("у сериала нельзя стереть количество серий", async () => {
    const { updateProjectAction } = await import("@/features/projects/actions");
    const result = await updateProjectAction(
      PROJECT,
      {},
      form({ name: "Сериал", type: "SERIES", episodeCount: "" }),
    );
    assert.equal(result.error, "Для сериала укажите количество серий");
    assert.equal(calls.length, 0);
  });
});

describe("персонаж", () => {
  it("требования", async () => {
    const { updateCharacterRequirementsAction } = await import("@/features/characters/actions");
    await updateCharacterRequirementsAction(
      PROJECT,
      ID,
      {},
      form({ description: "", roleRequirements: "" }),
    );
    const data = written("character");
    assert.equal(data.description, null);
    assert.equal(data.roleRequirements, null);
  });

  it("карточка", async () => {
    const { updateCharacterRecordAction } = await import("@/features/characters/actions");
    await updateCharacterRecordAction(
      PROJECT,
      ID,
      {},
      form({
        name: "Герой",
        description: "",
        roleRequirements: "",
        makeupOffsetMin: "",
        costumeOffsetMin: "",
      }),
    );
    const data = written("character");
    assert.equal(data.description, null);
    assert.equal(data.roleRequirements, null);
    assert.equal(data.makeupOffsetMin, null);
    assert.equal(data.costumeOffsetMin, null);
  });

  const castSnapshot = {
    lastName: "Иванов",
    riderNotes: "Райдер",
    shiftRate: 1000,
    proposedTerms: "Условия",
    skills: ["Верховая езда"],
  };
  const emptySnapshot = { riderNotes: "", shiftRate: "", proposedTerms: "", skills: "" };

  it("снимок актёра: всё стёрто, актёр тоже очищается", async () => {
    const { updateCharacterCastSnapshotAction } = await import("@/features/characters/actions");
    rows.character = { id: ID, castSnapshot };
    rows.actor = { id: "actor", specialConditions: "Условия" };
    await updateCharacterCastSnapshotAction(PROJECT, ID, {}, form(emptySnapshot));
    assert.deepEqual(written("character").castSnapshot, {
      lastName: "Иванов",
      riderNotes: null,
      shiftRate: null,
      proposedTerms: null,
      skills: [],
    });
    assert.deepEqual(written("actor"), { shiftRate: null, specialConditions: null });
  });

  it("снимок актёра без права на финансы: ставка и условия остаются", async () => {
    const { updateCharacterCastSnapshotAction } = await import("@/features/characters/actions");
    canFinance = false;
    rows.character = { id: ID, castSnapshot };
    rows.actor = { id: "actor", specialConditions: "Условия" };
    await updateCharacterCastSnapshotAction(PROJECT, ID, {}, form(emptySnapshot));
    const next = written("character").castSnapshot as typeof castSnapshot;
    assert.equal(next.riderNotes, null);
    assert.equal(next.shiftRate, 1000);
    assert.equal(next.proposedTerms, "Условия");
    assert.equal(calls.filter((c) => c.model === "actor").length, 0);
  });
});

describe("персонаж: снимок и актёр расходятся", () => {
  const bare = { lastName: "Иванов", riderNotes: "Райдер", shiftRate: null, proposedTerms: null };

  it("в снимке ставки нет, у актёра есть: правка райдера актёра не трогает", async () => {
    const { updateCharacterCastSnapshotAction } = await import("@/features/characters/actions");
    rows.character = { id: ID, castSnapshot: bare };
    rows.actor = { id: "actor", shiftRate: 5000, specialConditions: "Условия актёра" };
    await updateCharacterCastSnapshotAction(
      PROJECT,
      ID,
      {},
      form({ riderNotes: "Новый райдер", shiftRate: "", proposedTerms: "", skills: "" }),
    );
    assert.equal((written("character").castSnapshot as { riderNotes: string }).riderNotes, "Новый райдер");
    assert.equal(calls.filter((c) => c.model === "actor").length, 0);
  });

  it("новая ставка при пустых условиях: условия актёра остаются", async () => {
    const { updateCharacterCastSnapshotAction } = await import("@/features/characters/actions");
    rows.character = { id: ID, castSnapshot: bare };
    rows.actor = { id: "actor", specialConditions: "Условия актёра" };
    await updateCharacterCastSnapshotAction(
      PROJECT,
      ID,
      {},
      form({ riderNotes: "Райдер", shiftRate: "7000", proposedTerms: "", skills: "" }),
    );
    assert.deepEqual(written("actor"), { shiftRate: 7000 });
  });

  it("ставка у актёра изменена в гонораре: правка райдера её не переписывает", async () => {
    const { updateCharacterCastSnapshotAction } = await import("@/features/characters/actions");
    rows.character = { id: ID, castSnapshot: { ...bare, shiftRate: 1000, proposedTerms: "Условия" } };
    rows.actor = { id: "actor", shiftRate: 5000, specialConditions: "Другие" };
    await updateCharacterCastSnapshotAction(
      PROJECT,
      ID,
      {},
      form({ riderNotes: "Новый", shiftRate: "1000", proposedTerms: "Условия", skills: "" }),
    );
    assert.equal(calls.filter((c) => c.model === "actor").length, 0);
  });

  it("правка условий без ставки доходит до актёра", async () => {
    const { updateCharacterCastSnapshotAction } = await import("@/features/characters/actions");
    rows.character = { id: ID, castSnapshot: bare };
    rows.actor = { id: "actor", specialConditions: "Старые" };
    await updateCharacterCastSnapshotAction(
      PROJECT,
      ID,
      {},
      form({ riderNotes: "Райдер", shiftRate: "", proposedTerms: "Новые", skills: "" }),
    );
    assert.deepEqual(written("actor"), { specialConditions: "Новые" });
  });
});

describe("локация", () => {
  const scoutSnapshot = {
    title: "Дом",
    address: "Адрес",
    cost: 500,
    contactName: "Пётр",
    contactPhone: "123",
    notes: "Заметки",
  };
  const emptySnapshot = { address: "", cost: "", contactName: "", contactPhone: "", notes: "" };

  it("снимок площадки: всё стёрто, адрес и заметки локации тоже", async () => {
    const { updateLocationScoutSnapshotAction } = await import("@/features/locations/actions");
    rows.location = { id: ID, scoutSnapshot };
    await updateLocationScoutSnapshotAction(PROJECT, ID, {}, form(emptySnapshot));
    const data = written("location");
    assert.equal(data.address, null);
    assert.equal(data.notes, null);
    const next = data.scoutSnapshot as Record<string, unknown>;
    for (const field of ["address", "cost", "contactName", "contactPhone", "notes"]) {
      assert.equal(next[field], null, field);
    }
  });

  it("снимок площадки без права на финансы: стоимость остаётся", async () => {
    const { updateLocationScoutSnapshotAction } = await import("@/features/locations/actions");
    canFinance = false;
    rows.location = { id: ID, scoutSnapshot };
    await updateLocationScoutSnapshotAction(PROJECT, ID, {}, form(emptySnapshot));
    const next = written("location").scoutSnapshot as Record<string, unknown>;
    assert.equal(next.cost, 500);
    assert.equal(next.address, null);
  });

  it("в снимке адреса нет, у локации есть: правка телефона их не трогает", async () => {
    const { updateLocationScoutSnapshotAction } = await import("@/features/locations/actions");
    rows.location = { id: ID, scoutSnapshot: { title: "Дом", address: null, notes: null } };
    await updateLocationScoutSnapshotAction(
      PROJECT,
      ID,
      {},
      form({ ...emptySnapshot, contactPhone: "555" }),
    );
    const data = written("location");
    assert.equal(data.address, undefined);
    assert.equal(data.notes, undefined);
  });

  it("адрес локации изменён в карточке: правка телефона его не переписывает", async () => {
    const { updateLocationScoutSnapshotAction } = await import("@/features/locations/actions");
    rows.location = { id: ID, scoutSnapshot };
    await updateLocationScoutSnapshotAction(
      PROJECT,
      ID,
      {},
      form({ address: "Адрес", cost: "500", contactName: "Пётр", contactPhone: "555", notes: "Заметки" }),
    );
    const data = written("location");
    assert.equal(data.address, undefined);
    assert.equal(data.notes, undefined);
    assert.equal((data.scoutSnapshot as { contactPhone: string }).contactPhone, "555");
  });

  it("финансовые условия", async () => {
    const { updateLocationFinancialAction } = await import("@/features/locations/actions");
    rows.location = { id: ID };
    await updateLocationFinancialAction(
      PROJECT,
      ID,
      {},
      form({ shiftRate: "", shiftHoursMin: "", unpaidOvertimeMin: "", taxPercent: "" }),
    );
    const data = written("location");
    for (const field of ["shiftRate", "shiftHoursMin", "unpaidOvertimeMin", "taxPercent"]) {
      assert.equal(data[field], null, field);
    }
  });
});

describe("актёр", () => {
  const empty = {
    lastName: "Иванов",
    contractorType: "UNKNOWN",
    roleType: "SUPPORTING",
    firstName: "",
    phone1: "",
    email: "",
    tags: "",
    specialConditions: "",
    shiftRate: "",
    shiftHoursMin: "",
    taxPercent: "",
    pickupOffsetMin: "",
  };

  it("стёртое очищается, ставка тоже", async () => {
    const { updateActorAction } = await import("@/features/actors/actions");
    rows.actor = { id: ID, characterId: null };
    const result = await updateActorAction(PROJECT, ID, {}, form(empty));
    assert.equal(result.error, undefined);
    const data = written("actor");
    for (const field of [
      "firstName",
      "phone1",
      "email",
      "tags",
      "specialConditions",
      "shiftRate",
      "shiftHoursMin",
      "taxPercent",
      "pickupOffsetMin",
    ]) {
      assert.equal(data[field], null, field);
    }
    assert.equal(data.lastName, "Иванов");
    assert.equal(data.phone2, undefined);
  });

  it("без права на финансы ставка и условия не записываются", async () => {
    const { updateActorAction } = await import("@/features/actors/actions");
    canFinance = false;
    rows.actor = { id: ID, characterId: null };
    await updateActorAction(PROJECT, ID, {}, form(empty));
    const data = written("actor");
    assert.equal(data.firstName, null);
    for (const field of ["specialConditions", "shiftRate", "shiftHoursMin", "taxPercent"]) {
      assert.equal(field in data, false, field);
    }
  });
});

describe("кандидат кастинга", () => {
  const empty = {
    lastName: "Петров",
    firstName: "",
    phone: "",
    email: "",
    tags: "",
    notes: "",
    photoUrl: "",
    education: "",
    filmography: "",
    proposedRate: "",
    proposedTerms: "",
  };

  it("стёртое очищается", async () => {
    const { updateCastingPersonAction } = await import("@/features/casting/actions");
    rows.castingPerson = { id: ID };
    const result = await updateCastingPersonAction(PROJECT, ID, {}, form(empty));
    assert.equal(result.error, undefined);
    const data = written("castingPerson");
    for (const field of [
      "firstName",
      "phone",
      "email",
      "tags",
      "notes",
      "photoUrl",
      "education",
      "filmography",
      "proposedRate",
      "proposedTerms",
    ]) {
      assert.equal(data[field], null, field);
    }
  });

  it("без права на финансы ставка и условия не записываются", async () => {
    const { updateCastingPersonAction } = await import("@/features/casting/actions");
    canFinance = false;
    rows.castingPerson = { id: ID };
    await updateCastingPersonAction(PROJECT, ID, {}, form(empty));
    const data = written("castingPerson");
    assert.equal(data.notes, null);
    assert.equal("proposedRate" in data, false);
    assert.equal("proposedTerms" in data, false);
  });
});

describe("кандидат-локация", () => {
  const empty = {
    locationIds: [LOCATION],
    title: "Дом",
    address: "",
    cost: "",
    contactName: "",
    contactPhone: "",
    notes: "",
  };

  it("стёртое очищается", async () => {
    const { updateScoutCandidateAction } = await import("@/features/scout/actions");
    rows.scoutCandidate = { status: "NEW" };
    rows.locationCount = 1;
    const result = await updateScoutCandidateAction(PROJECT, ID, {}, form(empty));
    assert.equal(result.error, undefined);
    const data = written("scoutCandidate");
    for (const field of ["address", "cost", "contactName", "contactPhone", "notes"]) {
      assert.equal(data[field], null, field);
    }
  });

  it("без права на финансы стоимость не меняется", async () => {
    const { updateScoutCandidateAction } = await import("@/features/scout/actions");
    canFinance = false;
    rows.scoutCandidate = { status: "NEW" };
    rows.locationCount = 1;
    await updateScoutCandidateAction(PROJECT, ID, {}, form(empty));
    const data = written("scoutCandidate");
    assert.equal(data.address, null);
    assert.equal(data.cost, undefined);
  });
});

describe("ресурс", () => {
  const empty = {
    name: "Лампа",
    notes: "",
    shiftRate: "",
    shiftHoursMin: "",
    unpaidOvertimeMin: "",
    arrivalOffsetMin: "",
    taxPercent: "",
  };

  it("стёртое очищается", async () => {
    const { updateResourceItemAction } = await import("@/features/resources/actions");
    rows.resourceItem = { id: ID };
    await updateResourceItemAction(PROJECT, "category", ID, {}, form(empty));
    const data = written("resourceItem");
    for (const field of [
      "notes",
      "shiftRate",
      "shiftHoursMin",
      "unpaidOvertimeMin",
      "arrivalOffsetMin",
      "taxPercent",
    ]) {
      assert.equal(data[field], null, field);
    }
  });

  it("без права на финансы ставка не записывается", async () => {
    const { updateResourceItemAction } = await import("@/features/resources/actions");
    canFinance = false;
    rows.resourceItem = { id: ID };
    await updateResourceItemAction(PROJECT, "category", ID, {}, form(empty));
    const data = written("resourceItem");
    assert.equal(data.notes, null);
    assert.equal("shiftRate" in data, false);
    assert.equal("taxPercent" in data, false);
  });
});

describe("остальные формы", () => {
  it("роль: примечание", async () => {
    const { updateRoleAction } = await import("@/features/roles/actions");
    rows.projectRoleDefinition = { id: ID, name: "Роль", isSystem: false, permissions: {} };
    await updateRoleAction(PROJECT, ID, {}, form({ name: "Роль", note: "" }));
    assert.equal(written("projectRoleDefinition").note, null);
  });

  it("задача пост-продакшна: исполнитель и заметки", async () => {
    const { updatePostTaskAction } = await import("@/features/post/actions");
    await updatePostTaskAction(PROJECT, ID, {}, form({ title: "Монтаж", assignee: "", notes: "" }));
    const data = written("postTask");
    assert.equal(data.assignee, null);
    assert.equal(data.notes, null);
  });

  it("финансовая операция: заметки", async () => {
    const { updateFinanceOpAction } = await import("@/features/finance/actions");
    await updateFinanceOpAction(
      PROJECT,
      ID,
      {},
      form({ type: "EXPENSE", title: "Расход", amount: "10", operationDate: "2026-01-01", notes: "" }),
    );
    assert.equal(written("financeOperation").notes, null);
  });
});
