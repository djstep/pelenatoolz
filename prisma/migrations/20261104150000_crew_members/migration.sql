-- CreateEnum
CREATE TYPE "CrewMemberSource" AS ENUM ('MANUAL', 'CONTRACT');

-- CreateTable
CREATE TABLE "CrewMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT,
    "middleName" TEXT,
    "position" TEXT,
    "departmentId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" "CrewMemberSource" NOT NULL DEFAULT 'MANUAL',
    "syncedAt" TIMESTAMP(3),
    "syncedValues" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewMemberContract" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewMemberContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrewMember_projectId_archivedAt_idx" ON "CrewMember"("projectId", "archivedAt");

-- CreateIndex
CREATE INDEX "CrewMember_projectId_departmentId_sortOrder_idx" ON "CrewMember"("projectId", "departmentId", "sortOrder");

-- CreateIndex
CREATE INDEX "CrewMember_departmentId_idx" ON "CrewMember"("departmentId");

-- CreateIndex
CREATE INDEX "CrewMember_createdById_idx" ON "CrewMember"("createdById");

-- CreateIndex
CREATE INDEX "CrewMemberContract_contractId_idx" ON "CrewMemberContract"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMemberContract_crewMemberId_contractId_key" ON "CrewMemberContract"("crewMemberId", "contractId");

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMemberContract" ADD CONSTRAINT "CrewMemberContract_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMemberContract" ADD CONSTRAINT "CrewMemberContract_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Права «Команда» в матрице ролей (JSON в "ProjectRoleDefinition"."permissions").
--
-- «Команда» (crew): всем ролям — «Доступ» и «Просмотр», правка — только системному «Продюсеру».
-- «Команда: контакты» (crew_contacts): только системному «Продюсеру»; остальным выдаётся в ролях.
-- Владелец проекта всегда с ролью «Продюсер». Роли, где раздел уже есть, не трогаются —
-- миграцию можно применить повторно без вреда.

UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = r."permissions" || jsonb_build_object(
  'crew',
  jsonb_build_object(
    'access', true,
    'read', true,
    'create', false,
    'update', r."isSystem" AND r."name" = 'Продюсер',
    'delete', false,
    'financeRead', false,
    'financeWrite', false,
    'financeUnlock', false
  ),
  'crew_contacts',
  jsonb_build_object(
    'access', r."isSystem" AND r."name" = 'Продюсер',
    'read', false,
    'create', false,
    'update', false,
    'delete', false,
    'financeRead', false,
    'financeWrite', false,
    'financeUnlock', false
  )
)
WHERE jsonb_typeof(r."permissions") = 'object'
  AND r."permissions"->'crew' IS NULL;
