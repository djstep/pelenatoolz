/**
 * Тестовые аккаунты и проект «E2E приёмка» для приёмочных тестов (Playwright, `e2e/`).
 *
 *   npx tsx scripts/e2e-seed.ts            — создать, если нет (есть — только пароли и роли)
 *   npx tsx scripts/e2e-seed.ts --reset    — удалить проект «E2E приёмка» e2e-продюсера и создать заново
 *
 * База — только `E2E_DATABASE_URL` и `E2E_DIRECT_URL` из `.env.e2e`: без них или на другой базе — отказ.
 * Вдобавок база должна быть в `SEED_DATABASE_ENDPOINTS` или быть локальной `pelena_e2e`.
 * Пароли — случайные, в `.env.e2e` (в .gitignore); существующие не меняются. В вывод
 * пароли не попадают. Хеш — как в приложении (`bcrypt`, 12 раундов).
 */
import "../e2e/helpers/use-e2e-database";
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { parse } from "dotenv";
import { MembershipStatus, Prisma } from "@prisma/client";
import { DEFAULT_LEDGER_TYPES } from "../src/features/contracts/lib/vat";
import { ensureSectionsIn } from "../src/features/call-sheets/lib/sections";
import { DEFAULT_APPROVAL_STATUSES } from "../src/features/finance/lib/approval-statuses";
import {
  analyzeMainSheet,
  createMainSheetData,
  MAIN_HEADER_STYLE,
} from "../src/features/smeta/lib/main-sheet";
import { getDefaultProjectRoles, DEFAULT_ROLE_NAMES } from "../src/features/roles/default-roles";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildPermissionsDocument,
  type PermissionMatrix,
} from "../src/features/roles/permissions-matrix";
import { e2eDatabaseEnvProblem, resolveE2EDatabaseEnv } from "../src/shared/db/e2e-database-guard";
import { prisma } from "../src/shared/db/prisma";
import { databaseHost, seedDatabaseProblem } from "../src/shared/db/seed-database-guard";
import {
  DAYS,
  CREW,
  E2E_PROJECT_NAME,
  E2E_ROLE_NAMES,
  E2E_ROLES,
  FILLED_DAY,
  LAYOUT_DAYS,
  MONEY,
  NAMES,
  passwordEnvName,
  type E2ERoleKey,
} from "../e2e/fixtures/data";

const ENV_FILE = path.join(process.cwd(), ".env.e2e");
const ROLE_KEYS = Object.keys(E2E_ROLES) as E2ERoleKey[];

function guardDatabase() {
  const { DATABASE_URL, DIRECT_URL } = process.env;
  const problem =
    e2eDatabaseEnvProblem({ DATABASE_URL, DIRECT_URL }, resolveE2EDatabaseEnv()) ??
    seedDatabaseProblem({ DATABASE_URL, DIRECT_URL });
  if (problem) throw new Error(problem);
  console.log(`База: ${databaseHost(process.env.DATABASE_URL ?? "") ?? "?"}`);
}

function gitignoreHasEnvFile() {
  const gitignore = readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
  return gitignore.split(/\r?\n/).some((line) => line.trim() === ".env.e2e");
}

/**
 * Пароли из `.env.e2e`; недостающие — случайные. Новые строки только дописываются в конец:
 * адреса базы и комментарии владельца в файле не трогаем, при повторе ключа dotenv берёт последний.
 */
function ensurePasswords(): Record<E2ERoleKey, string> {
  if (!gitignoreHasEnvFile()) throw new Error(".env.e2e нет в .gitignore — остановлено");
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const env = parse(current);
  const added: string[] = [];
  for (const role of ROLE_KEYS) {
    const name = passwordEnvName(role);
    if (!env[name]) {
      env[name] = randomBytes(18).toString("base64url");
      added.push(`${name}=${env[name]}`);
    }
    const emailName = `E2E_${role.toUpperCase()}_EMAIL`;
    if (env[emailName] !== E2E_ROLES[role].email) {
      env[emailName] = E2E_ROLES[role].email;
      added.push(`${emailName}=${env[emailName]}`);
    }
  }
  if (added.length > 0) {
    const lines = current
      ? added
      : ["# Тестовые аккаунты приёмки (scripts/e2e-seed.ts). Не коммитить, не выводить в лог.", ...added];
    const separator = current && !current.endsWith("\n") ? "\n" : "";
    appendFileSync(ENV_FILE, `${separator}${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
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

/**
 * Команду видит и правит; без договоров, контактов и вызывных. Вызывные убраны намеренно: кто их
 * видит, получает доступ к общей папке на Диске, а тесты Диска считают доступы поимённо.
 */
function crewOnlyMatrix(): PermissionMatrix {
  const m = noCallSheetMatrix();
  const empty = buildEmptyMatrix();
  m.contracts = empty.contracts;
  m.crew_contacts = empty.crew_contacts;
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
        [E2E_ROLE_NAMES.crewonly, crewOnlyMatrix()],
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
          { projectId, userId: users.crewonly, roleId: roles.get(E2E_ROLE_NAMES.crewonly)!, status: MembershipStatus.ACTIVE },
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

/**
 * Дни 4 и 5 для вида листа вызывного (`LAYOUT_DAYS`): дописываются и в уже созданный проект,
 * если их нет; есть — не трогаются. День 4 — все блоки макета (сбор, времена, погода,
 * руководители, цеха, база, актёры с подачей машины, групповка, элементы, 2-й юнит, схема);
 * у спецтранспорта — ставка км (её в листе быть не должно). День 5 — пустой рабочий день.
 */
async function ensureLayoutDays(projectId: string) {
  const exists = await prisma.shootDay.findFirst({
    where: { projectId, dayNumber: LAYOUT_DAYS.filled.dayNumber },
    select: { id: true },
  });
  if (exists) return;
  await prisma.$transaction(
    async (tx) => {
      const [scenes, actors, sections, location] = await Promise.all([
        tx.scene.findMany({ where: { projectId, number: { in: ["1", "2"] } }, orderBy: { sortOrder: "asc" } }),
        tx.actor.findMany({ where: { projectId }, orderBy: { lastName: "desc" } }),
        tx.callSheetSection.findMany({ where: { projectId }, select: { id: true, key: true } }),
        tx.location.findFirst({ where: { projectId, name: NAMES.location }, select: { id: true } }),
      ]);
      const [scene1, scene2] = scenes;
      const actor = actors.find((a) => a.lastName === NAMES.actor.lastName);
      const actor2 = actors.find((a) => a.lastName === NAMES.actor2.lastName);
      if (!scene1 || !scene2 || !actor || !actor2 || !location) {
        throw new Error("В проекте нет сцен, актёров или объекта сида — npx tsx scripts/e2e-seed.ts --reset");
      }
      const section = (key: string) => {
        const id = sections.find((s) => s.key === key)?.id;
        if (!id) throw new Error(`Нет раздела элементов ${key}`);
        return id;
      };
      await tx.location.update({
        where: { id: location.id },
        data: {
          onSiteNotes: "Администратор у проходной с 07:00",
          points: {
            create: [
              { number: "1", name: "Проходная 3 · место сбора", description: "Вход по пропускам", sortOrder: 0 },
              { number: "2", name: FILLED_DAY.schemePoint, description: "Штаб, грим, костюм", sortOrder: 1 },
              { number: "3", name: "Съёмочная площадка", description: "Сцены 1, 2", sortOrder: 2 },
            ],
          },
        },
      });

      const filled = await tx.shootDay.create({
        data: {
          projectId,
          dayNumber: LAYOUT_DAYS.filled.dayNumber,
          date: day(LAYOUT_DAYS.filled.date),
          dayType: "WORKING",
          shiftNumber: 4,
          callTime: "07:30",
          shiftStartTime: "07:30",
          wrapTime: "19:30",
          rehearsalTime: "09:00",
          motorOnTime: "09:30",
          motorOffTime: "19:30",
          crewMeetTime: "07:30",
          crewMeetAddress: FILLED_DAY.crewMeetAddress,
          weatherNote: "Переменная облачность",
          weatherPrecip: "небольшой дождь",
        },
      });
      await tx.shootDay.create({
        data: {
          projectId,
          dayNumber: LAYOUT_DAYS.empty.dayNumber,
          date: day(LAYOUT_DAYS.empty.date),
          dayType: "WORKING",
        },
      });
      const shootDayId = filled.id;
      await tx.shootDayScene.createMany({
        data: [
          { shootDayId, sceneId: scene1.id, sortOrder: 0 },
          { shootDayId, sceneId: scene2.id, sortOrder: 1 },
        ],
      });
      await tx.shootDayTimeSlot.createMany({
        data: [
          { shootDayId, startTime: "07:30", endTime: "09:00", slotType: "MAKEUP_COSTUME", customLabel: "Грим, костюм, техническое освоение", sortOrder: 0 },
          { shootDayId, startTime: "09:00", endTime: "09:30", slotType: "REHEARSAL", sortOrder: 1 },
          { shootDayId, startTime: "09:30", endTime: "12:00", slotType: "SHOOTING", sceneId: scene1.id, notes: "Держать два зонта", sortOrder: 2 },
          { shootDayId, startTime: "12:00", endTime: "12:30", slotType: "PREP", sortOrder: 3 },
          { shootDayId, startTime: "12:30", endTime: "13:30", slotType: "SHOOTING", sceneId: scene2.id, sortOrder: 4 },
          { shootDayId, startTime: "13:30", endTime: "14:30", slotType: "LUNCH", sortOrder: 5 },
          { shootDayId, startTime: "14:30", endTime: "16:00", slotType: "SHOOTING", sceneId: scene2.id, isContinuation: true, sortOrder: 6 },
          { shootDayId, startTime: "16:00", endTime: "19:30", slotType: "SHOOTING", unit: "SECOND", customLabel: FILLED_DAY.secondUnit, sortOrder: 7 },
        ],
      });
      await tx.shootDayActorCall.createMany({
        data: [
          { shootDayId, actorId: actor.id, transportMode: "CAR", carPickupTime: "07:15", arrivalTime: "08:00", costumeTime: "08:00", makeupTime: "08:30", readyTime: "09:00", wrapTime: "19:30" },
          { shootDayId, actorId: actor2.id, transportMode: "SELF", arrivalTime: "08:00", costumeTime: "08:15", makeupTime: "08:30", readyTime: "09:00", wrapTime: "16:00" },
        ],
      });
      await tx.shootDayTransport.create({
        data: { shootDayId, name: "Манипулятор E2E", callTime: "08:00", wrapTime: "19:30", scenes: "2", kmRate: dec(MONEY.transportKmRate) },
      });
      await tx.callSheet.create({
        data: {
          projectId,
          shootDayId,
          tempDay: "+16",
          tempNight: "+12",
          importantNote: FILLED_DAY.important,
          actorRestrictions: FILLED_DAY.restrictions,
          schemeLocationId: location.id,
          leaders: {
            create: [
              { position: "Режиссёр-постановщик", personName: "Зайцев Кирилл", phone: "+7 900 000-00-11", sortOrder: 0 },
              { position: "Второй режиссёр", personName: FILLED_DAY.leader, phone: "+7 900 000-00-12", sortOrder: 1 },
              { position: "Директор группы", personName: "Гусев Павел", phone: "+7 900 000-00-13", sortOrder: 2 },
              { position: "Администратор", personName: "Никитин Олег", phone: "+7 900 000-00-14", sortOrder: 3 },
            ],
          },
          crewCalls: {
            create: [
              { label: "Администрация", callTime: "06:30", sortOrder: 0 },
              { label: "Режиссёрская группа", callTime: "07:30", sortOrder: 1 },
              { label: FILLED_DAY.crew, callTime: "07:30", sortOrder: 2 },
              { label: "Костюм, грим", callTime: "08:00", sortOrder: 3 },
              { label: "Звук", callTime: "08:20", sortOrder: 4 },
            ],
          },
          baseItems: {
            create: [
              { name: FILLED_DAY.base, callTime: "06:10", sortOrder: 0 },
              { name: "Штаб", callTime: "07:30", sortOrder: 1 },
              { name: "Грим, костюм", callTime: "07:30", sortOrder: 2 },
              { name: "Гриптрак", notNeeded: true, sortOrder: 3 },
            ],
          },
        },
      });
      const sheet = await tx.callSheet.findUniqueOrThrow({ where: { shootDayId }, select: { id: true } });
      await tx.callSheetElement.createMany({
        data: [
          { callSheetId: sheet.id, sectionId: section("GROUP"), name: FILLED_DAY.group, quantity: "1", scenes: "1, 2", readyTime: "09:00", wrapTime: "19:30", sortOrder: 0 },
          { callSheetId: sheet.id, sectionId: section("GROUP"), name: "Руки героя", quantity: "1", readyTime: "16:00", wrapTime: "19:30", secondUnit: true, sortOrder: 1 },
          { callSheetId: sheet.id, sectionId: section("PROPS"), name: FILLED_DAY.element, quantity: "2", scenes: "1", readyTime: "09:00", wrapTime: "19:30", sortOrder: 2 },
          { callSheetId: sheet.id, sectionId: section("STUNTS"), name: "Падение на лестнице", scenes: "2", readyTime: "12:30", wrapTime: "16:00", sortOrder: 3 },
          { callSheetId: sheet.id, sectionId: section("CAMERA"), name: "GoPro", quantity: "5", scenes: "1, 2", arrivalTime: "08:00", readyTime: "09:00", wrapTime: "19:30", sortOrder: 4 },
        ],
      });
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
  console.log(`Дни ${LAYOUT_DAYS.filled.dayNumber} (заполненный вызывной) и ${LAYOUT_DAYS.empty.dayNumber} (пустой) добавлены`);
}

/** Строка статьи основного листа: как сохраняет редактор (значения формул уже посчитаны). */
function budgetRow(row: number, code: string, name: string, days: number, rate: number) {
  const n = row + 1;
  const amount = days * rate;
  return {
    0: { v: code, t: 1 },
    1: { v: name, t: 1 },
    2: { v: "смена", t: 1 },
    3: { v: 1, t: 2 },
    4: { v: rate, t: 2 },
    5: { v: days, t: 2 },
    6: { v: amount, t: 2, f: `=D${n}*E${n}*F${n}` },
    7: { v: 0, t: 2 },
    8: { v: 0, t: 2, f: `=G${n}*H${n}/100` },
    9: { v: amount, t: 2, f: `=G${n}+I${n}` },
  };
}

/** Подытог раздела: СУММ по строкам статей (не статья, без кода). */
function budgetSubtotal(row: number, name: string, first: number, last: number, value: number) {
  return {
    1: { v: name, t: 1, s: "smetaHeader" },
    6: { v: value, t: 2, f: `=SUM(G${first}:G${last})`, s: "smetaHeader" },
    9: { v: value, t: 2, f: `=SUM(J${first}:J${last})`, s: "smetaHeader" },
  };
}

/** Смета цеха: разделы, 7 статей, подытоги, черновой лист. Цех отдельный — транспортный нужен тестам смет. */
function buildSeedBudgetSheet() {
  const sheet = createMainSheetData("main", "Основной");
  const staff = [
    ["OP-01.01", "Оператор-постановщик", 32, 45000],
    ["OP-01.02", "1-й ассистент оператора (фокус)", 32, 18000],
    ["OP-01.03", "2-й ассистент оператора", 32, 12000],
    ["OP-01.04", "DIT", 32, 15000],
  ] as const;
  const gear = [
    ["OP-02.01", "Камера, комплект", 32, 38000],
    ["OP-02.02", "Комплект оптики", 32, 22000],
    ["OP-02.03", "Видеоассист / плейбек", 32, 9000],
  ] as const;
  const cells = sheet.cellData as Record<number, unknown>;
  const sum = (rows: readonly (readonly [string, string, number, number])[]) =>
    rows.reduce((total, r) => total + r[2] * r[3], 0);
  let row = 1;
  cells[row++] = { 1: { v: "1. Персонал", t: 1, s: "smetaHeader" } };
  const staffFirst = row + 1;
  for (const [code, name, days, rate] of staff) {
    cells[row] = budgetRow(row, code, name, days, rate);
    row++;
  }
  cells[row] = budgetSubtotal(row, "Итого персонал", staffFirst, row, sum(staff));
  row++;
  cells[row++] = { 1: { v: "2. Техника", t: 1, s: "smetaHeader" } };
  const gearFirst = row + 1;
  for (const [code, name, days, rate] of gear) {
    cells[row] = budgetRow(row, code, name, days, rate);
    row++;
  }
  cells[row] = budgetSubtotal(row, "Итого техника", gearFirst, row, sum(gear));
  return sheet;
}

/** Продюсер — глава цеха со сметой: редактор открывается с правкой (Сохранить, Импорт, отправка). */
async function ensureSeedBudgetHead(projectId: string, departmentId: string, producerId: string) {
  const membership = await prisma.projectMembership.findFirstOrThrow({
    where: { projectId, userId: producerId },
    select: { id: true },
  });
  const head = await prisma.departmentHead.findFirst({
    where: { departmentId, membershipId: membership.id },
    select: { id: true },
  });
  if (!head) await prisma.departmentHead.create({ data: { departmentId, membershipId: membership.id } });
}

async function ensureSeedBudget(projectId: string, producerId: string) {
  const exists = await prisma.department.findFirst({
    where: { projectId, name: NAMES.smetaDepartment },
    select: { id: true },
  });
  if (exists) {
    await ensureSeedBudgetHead(projectId, exists.id, producerId);
    return;
  }
  const sheet = buildSeedBudgetSheet();
  const analysis = analyzeMainSheet(sheet);
  if (analysis.checks.length > 0) {
    throw new Error(`Смета сида: ${analysis.checks.map((c) => c.message).join("; ")}`);
  }
  await prisma.$transaction(
    async (tx) => {
      const department = await tx.department.create({
        data: { projectId, name: NAMES.smetaDepartment, codePrefix: "OP" },
      });
      const budget = await tx.budget.create({
        data: {
          projectId,
          departmentId: department.id,
          status: "DRAFT",
          styles: { ...MAIN_HEADER_STYLE },
          createdById: producerId,
        },
      });
      const main = await tx.budgetSheet.create({
        data: {
          budgetId: budget.id,
          sheetKey: "main",
          name: "Основной",
          sortOrder: 0,
          data: { create: { data: sheet as Prisma.InputJsonValue } },
        },
      });
      await tx.budgetSheet.create({
        data: {
          budgetId: budget.id,
          sheetKey: "draft",
          name: "Черновые расчёты",
          sortOrder: 1,
          data: {
            create: {
              data: {
                id: "draft",
                name: "Черновые расчёты",
                cellData: {
                  0: { 0: { v: "Лимит на смену", t: 1 }, 1: { v: 120000, t: 2 } },
                  1: { 0: { v: "Смен", t: 1 }, 1: { v: 32, t: 2 } },
                  2: { 0: { v: "Всего", t: 1 }, 1: { v: 3840000, t: 2, f: "=B1*B2" } },
                },
              },
            },
          },
        },
      });
      await tx.budget.update({ where: { id: budget.id }, data: { mainSheetId: main.id } });
      await tx.budgetItem.createMany({
        data: analysis.items.map((item) => ({
          projectId,
          departmentId: department.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          rate: item.rate,
          days: item.days,
          amount: item.amount,
          taxPercent: item.taxPercent,
          tax: item.tax,
          total: item.total,
          sortOrder: item.row,
        })),
      });
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
  const department = await prisma.department.findFirstOrThrow({
    where: { projectId, name: NAMES.smetaDepartment },
    select: { id: true },
  });
  await ensureSeedBudgetHead(projectId, department.id, producerId);
  console.log(`Смета цеха «${NAMES.smetaDepartment}» добавлена: статей ${analysis.items.length}`);
}

/** По одной записи для карточек: контрагент, договор, платёж, проба, кандидат скаута. */
async function ensureSeedCards(projectId: string, producerId: string) {
  const present = await prisma.counterparty.findFirst({
    where: { projectId, name: NAMES.counterparty },
    select: { id: true },
  });
  if (present) return;
  await prisma.$transaction(
    async (tx) => {
      const company = await tx.company.create({ data: { projectId, name: NAMES.company, inn: "7700000000" } });
      const counterparty = await tx.counterparty.create({
        data: { projectId, name: NAMES.counterparty, type: "LEGAL_ENTITY", inn: "7711111111", contacts: "+7 900 000-00-09" },
      });
      const status = await tx.projectApprovalStatus.findFirstOrThrow({ where: { projectId }, select: { id: true } });
      const contract = await tx.contract.create({
        data: {
          projectId,
          date: day("2026-10-20"),
          number: NAMES.contract,
          companyId: company.id,
          counterpartyId: counterparty.id,
          amount: dec("150000"),
          vatEnabled: false,
          amountWithVat: dec("150000"),
          statusId: status.id,
          summary: "Договор для снимков E2E",
        },
      });
      await tx.cashPayment.create({
        data: {
          projectId,
          counterpartyId: counterparty.id,
          companyId: company.id,
          contractId: contract.id,
          amount: dec("50000"),
          amountWithTax: dec("50000"),
          date: day("2026-10-25"),
          comment: "Платёж для снимков E2E",
          createdById: producerId,
        },
      });
      const person = await tx.castingPerson.findFirstOrThrow({ where: { projectId }, select: { id: true } });
      await tx.audition.create({
        data: {
          projectId,
          date: day("2026-10-15"),
          time: "12:00",
          comment: NAMES.audition,
          externalUrl: "https://example.com/e2e-audition",
          createdById: producerId,
          actors: { create: [{ personId: person.id }] },
        },
      });
      await tx.scoutCandidate.create({
        data: { projectId, title: NAMES.scout, address: "Московская обл., дачный посёлок", notes: "Кандидат для снимков E2E" },
      });
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
  console.log("Карточки добавлены: контрагент, договор, платёж, проба, кандидат скаута");
}

/**
 * Проект, созданный до волны 8: роль без договоров и контактов и её участник; права команды у
 * остальных тестовых ролей — как в только что созданном проекте (миграция дала им просмотр).
 */
async function ensureSeedCrewRoles(projectId: string, crewOnlyUserId: string) {
  const role = await prisma.projectRoleDefinition.upsert({
    where: { projectId_name: { projectId, name: E2E_ROLE_NAMES.crewonly } },
    create: {
      projectId,
      name: E2E_ROLE_NAMES.crewonly,
      note: "Приёмочные тесты",
      permissions: buildPermissionsDocument(crewOnlyMatrix(), {}) as Prisma.InputJsonValue,
    },
    update: { permissions: buildPermissionsDocument(crewOnlyMatrix(), {}) as Prisma.InputJsonValue },
    select: { id: true },
  });
  await prisma.projectMembership.upsert({
    where: { projectId_userId: { projectId, userId: crewOnlyUserId } },
    create: { projectId, userId: crewOnlyUserId, roleId: role.id, status: MembershipStatus.ACTIVE },
    update: {},
  });
  const full = noFinanceMatrix();
  const others = await prisma.projectRoleDefinition.findMany({
    where: { projectId, name: { in: [E2E_ROLE_NAMES.nofin, E2E_ROLE_NAMES.nocallsheet] } },
    select: { id: true, permissions: true },
  });
  for (const row of others) {
    await prisma.projectRoleDefinition.update({
      where: { id: row.id },
      data: {
        permissions: {
          ...(row.permissions as Prisma.JsonObject),
          crew: full.crew,
          crew_contacts: full.crew_contacts,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * Утверждённая версия вызывного дня 1: без неё файлы Диска зависели бы от утверждения в `c1-flows`.
 * Снимок собирает настоящий код сайта, поэтому отдельным процессом: он отключает защиту `server-only`.
 * Повторный запуск ничего не добавляет.
 */
async function ensureSeedApprovedCallSheet(projectId: string, producerId: string) {
  const day = await prisma.shootDay.findFirstOrThrow({
    where: { projectId, dayNumber: 1 },
    select: { id: true, callSheet: { select: { approvedVersions: { select: { id: true }, take: 1 } } } },
  });
  if (day.callSheet?.approvedVersions.length) return;
  const helper = path.join(process.cwd(), "e2e/helpers/seed-approved-call-sheet.ts");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", helper, projectId, day.id, producerId],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Сид остановлен: не удалось утвердить вызывной дня 1");
}

/** Договоры с людьми и команда для экрана /crew. Повторный запуск ничего не добавляет. */
async function ensureSeedCrew(projectId: string, producerId: string) {
  const company = await prisma.company.findFirstOrThrow({
    where: { projectId, name: NAMES.company },
    select: { id: true },
  });
  const status = await prisma.projectApprovalStatus.findFirstOrThrow({
    where: { projectId, key: "UNSIGNED" },
    select: { id: true },
  });
  const contractIds = new Map<string, string>();
  for (const item of Object.values(CREW.contracts)) {
    const present = await prisma.counterparty.findFirst({
      where: { projectId, name: item.counterparty },
      select: { id: true },
    });
    const counterparty =
      present ??
      (await prisma.counterparty.create({
        data: { projectId, name: item.counterparty, type: item.type, contacts: item.contacts },
        select: { id: true },
      }));
    const contractPresent = await prisma.contract.findFirst({
      where: { projectId, number: item.number },
      select: { id: true },
    });
    const contract =
      contractPresent ??
      (await prisma.contract.create({
        data: {
          projectId,
          date: day("2026-10-21"),
          number: item.number,
          companyId: company.id,
          counterpartyId: counterparty.id,
          amount: dec(CREW.contractAmount),
          vatEnabled: false,
          amountWithVat: dec(CREW.contractAmount),
          statusId: status.id,
        },
        select: { id: true },
      }));
    contractIds.set(item.number, contract.id);
  }

  const department = await prisma.department.findFirstOrThrow({
    where: { projectId, name: NAMES.transportDepartment },
    select: { id: true },
  });
  const linkedPresent = await prisma.crewMember.findFirst({
    where: { projectId, lastName: CREW.linked.lastName, firstName: CREW.linked.firstName },
    select: { id: true },
  });
  if (!linkedPresent) {
    await prisma.crewMember.create({
      data: {
        projectId,
        ...CREW.linked,
        departmentId: department.id,
        source: "CONTRACT",
        syncedAt: new Date(),
        syncedValues: { phone: CREW.linked.phone, email: CREW.linked.email },
        createdById: producerId,
        contractLinks: { create: { contractId: contractIds.get(CREW.contracts.individual.number)! } },
      },
    });
  }
  const manualPresent = await prisma.crewMember.findFirst({
    where: { projectId, lastName: CREW.manual.lastName, firstName: CREW.manual.firstName },
    select: { id: true },
  });
  if (!manualPresent) {
    await prisma.crewMember.create({
      data: { projectId, ...CREW.manual, departmentId: department.id, createdById: producerId },
    });
  }
}

async function main() {
  guardDatabase();
  const reset = process.argv.includes("--reset");
  const passwords = ensurePasswords();
  const users = await upsertUsers(passwords);
  console.log("Пользователи: e2e-producer, e2e-nofin, e2e-nocallsheet, e2e-crewonly — готовы");

  const existing = await prisma.project.findMany({
    where: { name: E2E_PROJECT_NAME, ownerUserId: users.producer },
    select: { id: true },
  });
  if (existing.length > 0 && !reset) {
    console.log(`Проект «${E2E_PROJECT_NAME}» уже есть: ${existing.map((p) => p.id).join(", ")} (--reset — создать заново)`);
    for (const { id } of existing) {
      await ensureLayoutDays(id);
      await ensureSeedBudget(id, users.producer);
      await ensureSeedCards(id, users.producer);
      await ensureSeedCrewRoles(id, users.crewonly);
      await ensureSeedCrew(id, users.producer);
      await ensureSeedApprovedCallSheet(id, users.producer);
    }
    return;
  }
  if (existing.length > 0) {
    // Только проект e2e-продюсера с этим именем — чужие проекты не трогаются.
    await prisma.project.deleteMany({ where: { id: { in: existing.map((p) => p.id) }, ownerUserId: users.producer } });
    console.log(`Старый проект «${E2E_PROJECT_NAME}» удалён`);
  }
  const projectId = await createProject(users);
  console.log(`Проект «${E2E_PROJECT_NAME}» создан: ${projectId}`);
  await ensureLayoutDays(projectId);
  await ensureSeedBudget(projectId, users.producer);
  await ensureSeedCards(projectId, users.producer);
  await ensureSeedCrew(projectId, users.producer);
  await ensureSeedApprovedCallSheet(projectId, users.producer);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
