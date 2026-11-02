-- Волна 3, диски, шаг 3: модель целиком (диск проекта, папки, доступы, выгрузки). Только новые таблицы и типы,
-- существующие таблицы не меняются.

-- CreateEnum
CREATE TYPE "ProjectDriveStatus" AS ENUM ('ACTIVE', 'DETACHED');

-- CreateEnum
CREATE TYPE "DriveFolderGrantStatus" AS ENUM ('OK', 'PENDING_ADD', 'PENDING_REMOVE', 'FAILED');

-- CreateEnum
CREATE TYPE "DriveExportDocType" AS ENUM ('CALL_SHEET', 'BUDGET');

-- CreateEnum
CREATE TYPE "DriveExportFormat" AS ENUM ('GOOGLE_SHEET', 'XLSX', 'PDF');

-- CreateTable
CREATE TABLE "ProjectDrive" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL DEFAULT 'GOOGLE_DRIVE',
    "keeperMembershipId" TEXT,
    "accountEmail" TEXT,
    "accountSubject" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "needsReconnectAt" TIMESTAMP(3),
    "status" "ProjectDriveStatus" NOT NULL DEFAULT 'ACTIVE',
    "detachedAt" TIMESTAMP(3),
    "detachReason" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDrive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectDriveId" TEXT,
    "cloudConnectionId" TEXT,
    "key" TEXT NOT NULL,
    "departmentId" TEXT,
    "externalId" TEXT NOT NULL,
    "webUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFolderGrant" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissionId" TEXT,
    "status" "DriveFolderGrantStatus" NOT NULL DEFAULT 'PENDING_ADD',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveFolderGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveExport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "docType" "DriveExportDocType" NOT NULL,
    "docId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "format" "DriveExportFormat" NOT NULL,
    "externalId" TEXT NOT NULL,
    "webUrl" TEXT,
    "version" INTEGER,
    "statusLabel" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDrive_projectId_key" ON "ProjectDrive"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDrive_keeperMembershipId_idx" ON "ProjectDrive"("keeperMembershipId");

-- CreateIndex
CREATE INDEX "DriveFolder_projectId_idx" ON "DriveFolder"("projectId");

-- CreateIndex
CREATE INDEX "DriveFolder_departmentId_idx" ON "DriveFolder"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFolder_projectDriveId_key_key" ON "DriveFolder"("projectDriveId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFolder_cloudConnectionId_projectId_key_key" ON "DriveFolder"("cloudConnectionId", "projectId", "key");

-- CreateIndex
CREATE INDEX "DriveFolderGrant_userId_idx" ON "DriveFolderGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFolderGrant_folderId_userId_key" ON "DriveFolderGrant"("folderId", "userId");

-- CreateIndex
CREATE INDEX "DriveExport_projectId_docType_docId_idx" ON "DriveExport"("projectId", "docType", "docId");

-- CreateIndex
CREATE INDEX "DriveExport_uploadedById_idx" ON "DriveExport"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "DriveExport_folderId_docType_docId_key" ON "DriveExport"("folderId", "docType", "docId");

-- AddForeignKey
ALTER TABLE "ProjectDrive" ADD CONSTRAINT "ProjectDrive_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDrive" ADD CONSTRAINT "ProjectDrive_keeperMembershipId_fkey" FOREIGN KEY ("keeperMembershipId") REFERENCES "ProjectMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_projectDriveId_fkey" FOREIGN KEY ("projectDriveId") REFERENCES "ProjectDrive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_cloudConnectionId_fkey" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolderGrant" ADD CONSTRAINT "DriveFolderGrant_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DriveFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolderGrant" ADD CONSTRAINT "DriveFolderGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveExport" ADD CONSTRAINT "DriveExport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveExport" ADD CONSTRAINT "DriveExport_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DriveFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveExport" ADD CONSTRAINT "DriveExport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Папка — либо на диске проекта, либо на личном диске: ровно одно из двух.
ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_owner_check" CHECK (("projectDriveId" IS NULL) <> ("cloudConnectionId" IS NULL));
