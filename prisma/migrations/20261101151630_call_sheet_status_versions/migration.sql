-- CreateEnum
CREATE TYPE "CallSheetStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED');

-- AlterTable
ALTER TABLE "CallSheet" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "CallSheetStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CallSheetApprovedVersion" (
    "id" TEXT NOT NULL,
    "callSheetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "snapshot" JSONB NOT NULL,
    "modelHash" TEXT NOT NULL,

    CONSTRAINT "CallSheetApprovedVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetApprovedVersion_callSheetId_version_key" ON "CallSheetApprovedVersion"("callSheetId", "version");

-- AddForeignKey
ALTER TABLE "CallSheet" ADD CONSTRAINT "CallSheet_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetApprovedVersion" ADD CONSTRAINT "CallSheetApprovedVersion_callSheetId_fkey" FOREIGN KEY ("callSheetId") REFERENCES "CallSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetApprovedVersion" ADD CONSTRAINT "CallSheetApprovedVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Раздел «Вызывные — утверждение» (callsheet_approve) в матрице прав ролей
-- (JSON в "ProjectRoleDefinition"."permissions"). Дописываются только данные.
--
-- В разделе есть только «Доступ»; остальные флаги всегда выключены.
-- Всем ролям раздел выключен, системному «Продюсеру» включён (как в шаблоне новых проектов).
-- Роли, где раздел уже есть, не трогаются — миграцию можно применить повторно без вреда.
UPDATE "ProjectRoleDefinition" AS r
SET "permissions" = r."permissions" || jsonb_build_object(
  'callsheet_approve',
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
  AND r."permissions"->'callsheet_approve' IS NULL;
