-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleEmail" TEXT;

-- CreateTable
CREATE TABLE "CallSheetTemplateLeader" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "shortTitle" TEXT,
    "membershipId" TEXT,
    "personName" TEXT,
    "phone" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetTemplateLeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetTemplateCrewCall" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT,
    "label" TEXT,
    "callTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetTemplateCrewCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetTemplateBaseItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "callTime" TEXT,
    "notNeeded" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetTemplateBaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "templateAppliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetLeader" (
    "id" TEXT NOT NULL,
    "callSheetId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "shortTitle" TEXT,
    "membershipId" TEXT,
    "personName" TEXT,
    "phone" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CallSheetLeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetCrewCall" (
    "id" TEXT NOT NULL,
    "callSheetId" TEXT NOT NULL,
    "departmentId" TEXT,
    "label" TEXT NOT NULL,
    "callTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CallSheetCrewCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetBaseItem" (
    "id" TEXT NOT NULL,
    "callSheetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "callTime" TEXT,
    "notNeeded" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CallSheetBaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallSheetTemplateLeader_projectId_sortOrder_idx" ON "CallSheetTemplateLeader"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallSheetTemplateLeader_membershipId_idx" ON "CallSheetTemplateLeader"("membershipId");

-- CreateIndex
CREATE INDEX "CallSheetTemplateCrewCall_projectId_sortOrder_idx" ON "CallSheetTemplateCrewCall"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallSheetTemplateCrewCall_departmentId_idx" ON "CallSheetTemplateCrewCall"("departmentId");

-- CreateIndex
CREATE INDEX "CallSheetTemplateBaseItem_projectId_sortOrder_idx" ON "CallSheetTemplateBaseItem"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CallSheet_shootDayId_key" ON "CallSheet"("shootDayId");

-- CreateIndex
CREATE INDEX "CallSheet_projectId_idx" ON "CallSheet"("projectId");

-- CreateIndex
CREATE INDEX "CallSheetLeader_callSheetId_sortOrder_idx" ON "CallSheetLeader"("callSheetId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallSheetLeader_membershipId_idx" ON "CallSheetLeader"("membershipId");

-- CreateIndex
CREATE INDEX "CallSheetCrewCall_callSheetId_sortOrder_idx" ON "CallSheetCrewCall"("callSheetId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallSheetCrewCall_departmentId_idx" ON "CallSheetCrewCall"("departmentId");

-- CreateIndex
CREATE INDEX "CallSheetBaseItem_callSheetId_sortOrder_idx" ON "CallSheetBaseItem"("callSheetId", "sortOrder");

-- AddForeignKey
ALTER TABLE "CallSheetTemplateLeader" ADD CONSTRAINT "CallSheetTemplateLeader_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetTemplateLeader" ADD CONSTRAINT "CallSheetTemplateLeader_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ProjectMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetTemplateCrewCall" ADD CONSTRAINT "CallSheetTemplateCrewCall_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetTemplateCrewCall" ADD CONSTRAINT "CallSheetTemplateCrewCall_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetTemplateBaseItem" ADD CONSTRAINT "CallSheetTemplateBaseItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheet" ADD CONSTRAINT "CallSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheet" ADD CONSTRAINT "CallSheet_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetLeader" ADD CONSTRAINT "CallSheetLeader_callSheetId_fkey" FOREIGN KEY ("callSheetId") REFERENCES "CallSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetLeader" ADD CONSTRAINT "CallSheetLeader_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ProjectMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetCrewCall" ADD CONSTRAINT "CallSheetCrewCall_callSheetId_fkey" FOREIGN KEY ("callSheetId") REFERENCES "CallSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetCrewCall" ADD CONSTRAINT "CallSheetCrewCall_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetBaseItem" ADD CONSTRAINT "CallSheetBaseItem_callSheetId_fkey" FOREIGN KEY ("callSheetId") REFERENCES "CallSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
