/**
 * Тестовые аккаунты и проект «E2E приёмка» для приёмочных тестов (Playwright, `e2e/`).
 *
 *   npx tsx scripts/e2e-seed.ts            — создать, если нет (есть — только пароли и роли)
 *   npx tsx scripts/e2e-seed.ts --reset    — удалить проект «E2E приёмка» e2e-продюсера и создать заново
 *
 * Только для ветки базы e2e: адрес прода (`ep-steep-sound…`) — отказ.
 * Пароли — случайные, в `.env.e2e` (в .gitignore); существующие не меняются. В вывод
 * пароли не попадают. Хеш — как в приложении (`bcrypt`, 12 раундов).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { MembershipStatus, Prisma } from "@prisma/client";
import { DEFAULT_LEDGER_TYPES } from "../src/features/contracts/lib/vat";
import { ensureSectionsIn } from "../src/features/call-sheets/lib/sections";
import { DEFAULT_APPROVAL_STATUSES } from "../src/features/finance/lib/approval-statuses";
import { getDefaultProjectRoles, DEFAULT_ROLE_NAMES } from "../src/features/roles/default-roles";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildPermissionsDocument,
  type PermissionMatrix,
} from "../src/features/roles/permissions-matrix";
import { prisma } from "../src/shared/db/prisma";
import {
  DAYS,
  E2E_PROJECT_NAME,
  E2E_ROLE_NAMES,
  E2E_ROLES,
  MONEY,
  NAMES,
  passwordEnvName,
  type E2ERoleKey,
} from "../e2e/fixtures/data";

const PROD_HOST_MARK = "ep-steep-sound";
const ENV_FILE = path.join(process.cwd(), ".env.e2e");
const ROLE_KEYS = Object.keys(E2E_ROLES) as E2ERoleKey[];

function guardDatabase() {
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const value = process.env[name] ?? "";
    if (value.includes(PROD_HOST_MARK)) {
      throw new Error(`${name} указывает на прод (${PROD_HOST_MARK}…) — остановлено`);
    }
  }
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "?";
  console.log(`База: ${host}`);
}

function gitignoreHasEnvFile() {
  const gitignore = readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
  return gitignore.split(/\r?\n/).some((line) => line.trim() === ".env.e2e");
}

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Пароли из `.env.e2e`; недостающие — случайные, файл дописывается. */
function ensurePasswords(): Record<E2ERoleKey, string> {
  if (!gitignoreHasEnvFile()) throw new Error(".env.e2e нет в .gitignore — остановлено");
  const env = readEnvFile();
  let changed = false;
  for (const role of ROLE_KEYS) {
    const name = passwordEnvName(role);
    if (!env[name]) {
      env[name] = randomBytes(18).toString("base64url");
      changed = true;
    }
    const emailName = `E2E_${role.toUpperCase()}_EMAIL`;
    if (env[emailName] !== E2E_ROLES[role].email) {
      env[emailName] = E2E_ROLES[role].email;
      changed = true;
    }
  }
  if (changed) {
    const body = [
      "# Тестовые аккаунты приёмки (scripts/e2e-seed.ts). Не коммитить, не выводить в лог.",
      ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
      "",
    ].join("\n");
    writeFileSync(ENV_FILE, body, { encoding: "utf8", mode: 0o600 });
    console.log(".env.e2e обновлён");
  }
  return Object.fromEntries(ROLE_KEYS.map((r) => [r, env[passwordEnvName(r)]])) as Record<E2ERoleKey, string>;
}

/** Всё как у продюсера, но без денег: ни «Финансов», ни фин. условий, ни смет, ни утверждения. */
function noFinanceMatrix(): PermissionMatrix {
  const m = buildFullMatrix();
  for (const section of Object.keys(m) as (keyof PermissionMatrix)[]) {
    m[section] = { ...m[section], financeRead: false, financeWrite: false, financeUnlock: false };
  }
  const empty = buildEmptyMatrix();
  m.finance = empty.finance;
  m.smeta_all = empty.smeta_all;
  m.callsheet_approve = empty.callsheet_approve;
  m.members = { ...empty.members, access: true, read: true };
  m.project_settings = { ...empty.project_settings, access: true, read: true };
  return m;
}

function noCallSheetMatrix(): PermissionMatrix {
  const m = noFinanceMatrix();
  m.schedule = buildEmptyMatrix().schedule;
  return m;
}

async function upsertUsers(passwords: Record<E2ERoleKey, string>) {
  const ids = {} as Record<E2ERoleKey, string>;
  for (const role of ROLE_KEYS) {
    const { email, name } = E2E_ROLES[role];
    const passwordHash = await bcrypt.hash(passwords[role], 12);
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash },
      update: { name, passwordHash },
      select: { id: true },
    });
    ids[role] = user.id;
  }
  return ids;
}

const dec = (v: string) => new Prisma.Decimal(v);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function createProject(users: Record<E2ERoleKey, string>) {
  return prisma.$transaction(
    async (tx) => {
      const project = await tx.project.create({
        data: {
          name: E2E_PROJECT_NAME,
          type: "FEATURE",
          status: "SHOOTING",
          city: "Москва",
          timezone: "Europe/Moscow",
          createdById: users.producer,
          ownerUserId: users.producer,
        },
      });
      const projectId = project.id;

      const roles = new Map<string, string>();
      for (const role of getDefaultProjectRoles()) {
        const row = await tx.projectRoleDefinition.create({
          data: { projectId, name: role.name, note: role.note, isSystem: role.isSystem, permissions: role.permissions },
        });
        roles.set(role.name, row.id);
      }
      for (const [name, matrix] of [
        [E2E_ROLE_NAMES.nofin, noFinanceMatrix()],
        [E2E_ROLE_NAMES.nocallsheet, noCallSheetMatrix()],
      ] as const) {
        const row = await tx.projectRoleDefinition.create({
          data: {
            projectId,
            name,
            note: "Приёмочные тесты",
            permissions: buildPermissionsDocument(matrix, {}) as Prisma.InputJsonValue,
          },
        });
        roles.set(name, row.id);
      }
      await tx.projectApprovalStatus.createMany({
        data: DEFAULT_APPROVAL_STATUSES.map((s) => ({ projectId, ...s, isSystem: true })),
      });
      await tx.projectLedgerType.createMany({
        data: DEFAULT_LEDGER_TYPES.map((t) => ({ projectId, name: t.name, isSystem: true, sortOrder: t.sortOrder })),
      });
      await tx.projectMembership.createMany({
        data: [
          { projectId, userId: users.producer, roleId: roles.get(DEFAULT_ROLE_NAMES.producer)!, status: MembershipStatus.ACTIVE },
          { projectId, userId: users.nofin, roleId: roles.get(E2E_ROLE_NAMES.nofin)!, status: MembershipStatus.ACTIVE },
          { projectId, userId: users.nocallsheet, roleId: roles.get(E2E_ROLE_NAMES.nocallsheet)!, status: MembershipStatus.ACTIVE },
        ],
      });

      // Смета: цех и статья (для спецтранспорта и отчёта смены).
      const department = await tx.department.create({
        data: { projectId, name: "Транспортный цех", codePrefix: "TR" },
      });
      const budgetItem = await tx.budgetItem.create({
        data: {
          projectId,
          departmentId: department.id,
          code: "TR-01.01",
          name: "Спецтехника",
          unit: "смена",
          quantity: dec("2"),
          rate: dec(MONEY.budgetRate),
          days: dec("1"),
          amount: dec(MONEY.budgetRate).mul(2),
          taxPercent: dec("0"),
          tax: dec("0"),
          total: dec(MONEY.budgetRate).mul(2),
          sortOrder: 1,
        },
      });

      const location = await tx.location.create({
        data: {
          projectId,
          name: NAMES.location,
          address: "Москва, ул. Тестовая, 1",
          shiftRate: dec(MONEY.locationShiftRate),
          taxPercent: dec(MONEY.locationTaxPercent),
          shiftHoursMin: 720,
          directions: "Вход со двора",
          parking: "Во дворе",
        },
      });

      const [ivan, maria] = await Promise.all(
        [NAMES.character, NAMES.character2].map((name) =>
          tx.character.create({ data: { projectId, name, roleType: "LEAD" } }),
        ),
      );
      const actor = await tx.actor.create({
        data: {
          projectId,
          characterId: ivan.id,
          ...NAMES.actor,
          phone1: "+7 900 000-00-01",
          roleType: "LEAD",
          shiftRate: dec(MONEY.actorShiftRate),
          taxPercent: dec(MONEY.actorTaxPercent),
          shiftHoursMin: 720,
          defaultBudgetItemId: budgetItem.id,
          overtimeRates: { create: [{ hourNumber: 1, amount: dec(MONEY.actorOvertimeAmount) }] },
          extraPayments: { create: [{ amount: dec(MONEY.actorExtraPayment), description: "Доплата E2E" }] },
        },
      });
      const actor2 = await tx.actor.create({
        data: {
          projectId,
          characterId: maria.id,
          ...NAMES.actor2,
          phone1: "+7 900 000-00-02",
          roleType: "LEAD",
          shiftRate: dec(MONEY.actor2ShiftRate),
          taxPercent: dec(MONEY.actorTaxPercent),
        },
      });

      const person = await tx.castingPerson.create({
        data: {
          projectId,
          ...NAMES.castingPerson,
          phone: "+7 900 000-00-03",
          proposedRate: dec(MONEY.castingProposedRate),
          proposedTerms: "12 смен",
        },
      });
      await tx.castingCandidate.create({
        data: { projectId, characterId: ivan.id, personId: person.id, rating: 4 },
      });

      const vehicles = await tx.resourceCategory.create({
        data: { projectId, name: "Игровой транспорт", tracksMileage: true, sortOrder: 1 },
      });
      const props = await tx.resourceCategory.create({
        data: { projectId, name: "Реквизит", sortOrder: 2 },
      });
      const tech = await tx.resourceCategory.create({
        data: { projectId, name: "Техника", perShift: true, sortOrder: 3 },
      });
      const vehicle = await tx.resourceItem.create({
        data: {
          categoryId: vehicles.id,
          name: NAMES.vehicle,
          shiftRate: dec(MONEY.vehicleShiftRate),
          kmRate: dec(MONEY.vehicleKmRate),
          taxPercent: dec(MONEY.resourceTaxPercent),
          defaultBudgetItemId: budgetItem.id,
        },
      });
      const prop = await tx.resourceItem.create({
        data: { categoryId: props.id, name: "Чемодан E2E", shiftRate: dec(MONEY.propShiftRate), taxPercent: dec(MONEY.resourceTaxPercent) },
      });
      const generator = await tx.resourceItem.create({
        data: { categoryId: tech.id, name: "Генератор E2E", shiftRate: dec(MONEY.generatorShiftRate) },
      });

      const scenes = [];
      for (const [index, s] of [
        { number: "1", title: "Утро в квартире", intExt: "INT", dayNight: "DAY", chars: [ivan, maria], items: [vehicle, prop] },
        { number: "2", title: "Ночной двор", intExt: "EXT", dayNight: "NIGHT", chars: [ivan], items: [vehicle] },
        { number: "3", title: "Разговор на кухне", intExt: "INT", dayNight: "DAY", chars: [maria], items: [prop] },
      ].entries()) {
        const scene = await tx.scene.create({
          data: {
            projectId,
            number: s.number,
            title: s.title,
            intExt: s.intExt as "INT" | "EXT",
            dayNight: s.dayNight as "DAY" | "NIGHT",
            scriptDay: 1,
            pageCount: dec("1.5"),
            planSeconds: 120,
            sortOrder: index,
            locations: { create: [{ locationId: location.id }] },
            characters: { create: s.chars.map((c) => ({ characterId: c.id })) },
            resourceItems: { create: s.items.map((i) => ({ itemId: i.id })) },
            resources: {
              create: [{ category: "PROP", name: "Пакет E2E", quantity: 1, unitPrice: dec(MONEY.sceneResourceUnitPrice), total: dec(MONEY.sceneResourceUnitPrice) }],
            },
          },
        });
        scenes.push(scene);
      }

      // Версия сценария — для редактора и его «PDF».
      await tx.scriptVersion.create({
        data: {
          projectId,
          versionNumber: 1,
          title: "Версия E2E",
          isCurrent: true,
          createdById: users.producer,
          blocks: {
            create: [
              { projectId, sceneId: scenes[0].id, type: "SLUGLINE", content: "1. ИНТ. КВАРТИРА ИВАНОВЫХ — ДЕНЬ", sortOrder: 0 },
              { projectId, sceneId: scenes[0].id, type: "ACTION", content: "Иван собирает чемодан.", sortOrder: 1 },
              { projectId, sceneId: scenes[0].id, type: "CHARACTER", content: "ИВАН", sortOrder: 2 },
              { projectId, sceneId: scenes[0].id, type: "DIALOGUE", content: "Опаздываем.", sortOrder: 3 },
            ],
          },
        },
      });

      const days = [];
      for (const d of DAYS) {
        days.push(
          await tx.shootDay.create({
            data: {
              projectId,
              dayNumber: d.dayNumber,
              date: day(d.date),
              dayType: d.dayType,
              callTime: d.dayType === "WORKING" ? "08:00" : null,
              wrapTime: d.dayType === "WORKING" ? "20:00" : null,
              shiftStartTime: d.dayType === "WORKING" ? "09:00" : null,
            },
          }),
        );
      }
      const [day1, day2] = days;
      await tx.shootDayScene.createMany({
        data: [
          { shootDayId: day1.id, sceneId: scenes[0].id, sortOrder: 0 },
          { shootDayId: day1.id, sceneId: scenes[1].id, sortOrder: 1 },
          { shootDayId: day2.id, sceneId: scenes[2].id, sortOrder: 0 },
        ],
      });
      await tx.shootDayActorCall.createMany({
        data: [
          { shootDayId: day1.id, actorId: actor.id, arrivalTime: "08:30", readyTime: "09:30", transportMode: "CAR", carPickupTime: "07:45" },
          { shootDayId: day1.id, actorId: actor2.id, arrivalTime: "09:00", readyTime: "10:00", transportMode: "SELF" },
          { shootDayId: day2.id, actorId: actor2.id, arrivalTime: "08:30", readyTime: "09:30" },
        ],
      });
      const transport = await tx.shootDayTransport.create({
        data: {
          shootDayId: day1.id,
          name: NAMES.transport,
          callTime: "07:00",
          wrapTime: "19:00",
          scenes: "1, 2",
          kmRate: dec(MONEY.transportKmRate),
          budgetItemId: budgetItem.id,
        },
      });
      await tx.shootDayResourceUsage.create({ data: { shootDayId: day1.id, itemId: generator.id } });

      // Вызывной дня 1 — черновик; у дня 2 вызывного нет (его создаёт тест продюсера).
      await ensureSectionsIn(
        {
          list: () => tx.callSheetSection.findMany({ where: { projectId }, select: { id: true, key: true, sortOrder: true } }),
          setSortOrders: async (rows) => {
            for (const row of rows) await tx.callSheetSection.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } });
          },
          createManySkipDuplicates: async (rows) => (await tx.callSheetSection.createMany({ data: rows, skipDuplicates: true })).count,
        },
        projectId,
      );
      await tx.callSheet.create({
        data: { projectId, shootDayId: day1.id, tempDay: "+12", importantNote: "Проверка E2E", schemeLocationId: location.id },
      });

      // Отчёт смены дня 1 — со ставками и суммами в строках.
      await tx.productionReport.create({
        data: {
          shootDayId: day1.id,
          factShiftStart: "09:00",
          factShiftEnd: "21:00",
          workRows: {
            create: [
              {
                kind: "ACTOR",
                actorId: actor.id,
                sourceKey: `actor:${actor.id}`,
                displayName: `${NAMES.actor.lastName} ${NAMES.actor.firstName}`,
                factStart: "08:30",
                factEnd: "21:00",
                shiftRate: dec(MONEY.actorShiftRate),
                taxPercent: dec(MONEY.actorTaxPercent),
                shiftPay: dec(MONEY.actorShiftRate),
                totalPay: dec(MONEY.reportTotalPay),
                sortOrder: 0,
              },
              {
                kind: "TRANSPORT",
                sourceKey: `transport:${transport.id}`,
                displayName: NAMES.transport,
                tracksMileage: true,
                factKm: dec("120"),
                kmRate: dec(MONEY.transportKmRate),
                mileagePay: dec(MONEY.reportMileagePay),
                budgetItemId: budgetItem.id,
                sortOrder: 1,
              },
              {
                kind: "LOCATION",
                locationId: location.id,
                sourceKey: `location:${location.id}`,
                displayName: NAMES.location,
                shiftRate: dec(MONEY.locationShiftRate),
                taxPercent: dec(MONEY.locationTaxPercent),
                sortOrder: 2,
              },
            ],
          },
        },
      });

      return projectId;
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
}

async function main() {
  guardDatabase();
  const reset = process.argv.includes("--reset");
  const passwords = ensurePasswords();
  const users = await upsertUsers(passwords);
  console.log("Пользователи: e2e-producer, e2e-nofin, e2e-nocallsheet — готовы");

  const existing = await prisma.project.findMany({
    where: { name: E2E_PROJECT_NAME, ownerUserId: users.producer },
    select: { id: true },
  });
  if (existing.length > 0 && !reset) {
    console.log(`Проект «${E2E_PROJECT_NAME}» уже есть: ${existing.map((p) => p.id).join(", ")} (--reset — создать заново)`);
    return;
  }
  if (existing.length > 0) {
    // Только проект e2e-продюсера с этим именем — чужие проекты не трогаются.
    await prisma.project.deleteMany({ where: { id: { in: existing.map((p) => p.id) }, ownerUserId: users.producer } });
    console.log(`Старый проект «${E2E_PROJECT_NAME}» удалён`);
  }
  const projectId = await createProject(users);
  console.log(`Проект «${E2E_PROJECT_NAME}» создан: ${projectId}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
