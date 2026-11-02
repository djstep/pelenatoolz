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
  FILLED_DAY,
  LAYOUT_DAYS,
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
    for (const { id } of existing) await ensureLayoutDays(id);
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
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
