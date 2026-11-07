-- Волна 9: календарь препродакшена. Таблицы событий, справочник типов, права ролей.
-- CreateTable
CREATE TABLE "PrepEventType" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepEventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE,
    "endDate" DATE,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "locationText" TEXT,
    "locationId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepEventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "crewMemberId" TEXT,
    "actorId" TEXT,
    "castingPersonId" TEXT,

    CONSTRAINT "PrepEventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepEventDepartment" (
    "eventId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "PrepEventDepartment_pkey" PRIMARY KEY ("eventId","departmentId")
);

-- CreateIndex
CREATE INDEX "PrepEventType_projectId_sortOrder_idx" ON "PrepEventType"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PrepEventType_projectId_name_key" ON "PrepEventType"("projectId", "name");

-- CreateIndex
CREATE INDEX "PrepEvent_projectId_startDate_idx" ON "PrepEvent"("projectId", "startDate");

-- CreateIndex
CREATE INDEX "PrepEvent_projectId_startAt_idx" ON "PrepEvent"("projectId", "startAt");

-- CreateIndex
CREATE INDEX "PrepEvent_typeId_idx" ON "PrepEvent"("typeId");

-- CreateIndex
CREATE INDEX "PrepEvent_locationId_idx" ON "PrepEvent"("locationId");

-- CreateIndex
CREATE INDEX "PrepEvent_createdById_idx" ON "PrepEvent"("createdById");

-- CreateIndex
CREATE INDEX "PrepEventParticipant_crewMemberId_idx" ON "PrepEventParticipant"("crewMemberId");

-- CreateIndex
CREATE INDEX "PrepEventParticipant_actorId_idx" ON "PrepEventParticipant"("actorId");

-- CreateIndex
CREATE INDEX "PrepEventParticipant_castingPersonId_idx" ON "PrepEventParticipant"("castingPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepEventParticipant_eventId_crewMemberId_key" ON "PrepEventParticipant"("eventId", "crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepEventParticipant_eventId_actorId_key" ON "PrepEventParticipant"("eventId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepEventParticipant_eventId_castingPersonId_key" ON "PrepEventParticipant"("eventId", "castingPersonId");

-- CreateIndex
CREATE INDEX "PrepEventDepartment_departmentId_idx" ON "PrepEventDepartment"("departmentId");

-- AddForeignKey
ALTER TABLE "PrepEventType" ADD CONSTRAINT "PrepEventType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEvent" ADD CONSTRAINT "PrepEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEvent" ADD CONSTRAINT "PrepEvent_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "PrepEventType"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEvent" ADD CONSTRAINT "PrepEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEvent" ADD CONSTRAINT "PrepEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEventParticipant" ADD CONSTRAINT "PrepEventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PrepEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEventParticipant" ADD CONSTRAINT "PrepEventParticipant_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEventParticipant" ADD CONSTRAINT "PrepEventParticipant_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEventParticipant" ADD CONSTRAINT "PrepEventParticipant_castingPersonId_fkey" FOREIGN KEY ("castingPersonId") REFERENCES "CastingPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEventDepartment" ADD CONSTRAINT "PrepEventDepartment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PrepEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepEventDepartment" ADD CONSTRAINT "PrepEventDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma не описывает CHECK в схеме, поэтому правила дат и участников заданы здесь.
-- Весь день: только даты. Со временем: только моменты времени. Окончание не раньше начала.
ALTER TABLE "PrepEvent" ADD CONSTRAINT "PrepEvent_dates_check" CHECK (
  (
    "allDay"
    AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL
    AND "startAt" IS NULL AND "endAt" IS NULL
    AND "endDate" >= "startDate"
  ) OR (
    NOT "allDay"
    AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL
    AND "startDate" IS NULL AND "endDate" IS NULL
    AND "endAt" >= "startAt"
  )
);

-- Участник — ровно один из трёх: человек команды, актёр или кандидат кастинга.
ALTER TABLE "PrepEventParticipant" ADD CONSTRAINT "PrepEventParticipant_one_person_check"
  CHECK (num_nonnulls("crewMemberId", "actorId", "castingPersonId") = 1);

-- Начальные типы событий всем существующим проектам. Новым проектам их создаёт код
-- (`DEFAULT_PREP_EVENT_TYPES`), списки совпадают: это проверяет юнит-тест.
INSERT INTO "PrepEventType" ("id", "projectId", "name", "color", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, p."id", t."name", t."color", t."sortOrder", CURRENT_TIMESTAMP
FROM "Project" AS p
CROSS JOIN (
  VALUES
    ('Встреча', 'blue', 0),
    ('Читка', 'violet', 1),
    ('Выбор объекта', 'green', 2),
    ('Техпроход', 'teal', 3),
    ('Примерка', 'pink', 4),
    ('Грим-тест', 'amber', 5),
    ('Репетиция', 'red', 6),
    ('Тест камеры', 'teal', 7),
    ('Производственное совещание', 'blue', 8),
    ('Другое', 'gray', 9)
) AS t("name", "color", "sortOrder")
ON CONFLICT ("projectId", "name") DO NOTHING;

-- Права «Календарь препродакшена» в матрице ролей (JSON в "ProjectRoleDefinition"."permissions").
-- Всем ролям — «Доступ» и «Просмотр», правка — только системному «Продюсеру».
-- Владелец проекта всегда с ролью «Продюсер». Роли, где раздел уже есть, не трогаются —
-- миграцию можно применить повторно без вреда.
UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = r."permissions" || jsonb_build_object(
  'calendar',
  jsonb_build_object(
    'access', true,
    'read', true,
    'create', false,
    'update', r."isSystem" AND r."name" = 'Продюсер',
    'delete', false,
    'financeRead', false,
    'financeWrite', false,
    'financeUnlock', false
  )
)
WHERE jsonb_typeof(r."permissions") = 'object'
  AND r."permissions"->'calendar' IS NULL;
