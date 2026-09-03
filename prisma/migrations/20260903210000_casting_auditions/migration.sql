-- CreateEnum
CREATE TYPE "ProjectFileKind" AS ENUM ('IMAGE', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectFileStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProjectFileKind" NOT NULL,
    "status" "ProjectFileStatus" NOT NULL DEFAULT 'UPLOADING',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "url" TEXT,
    "thumbnailUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoFileId" TEXT,
    "externalUrl" TEXT,
    "date" DATE NOT NULL,
    "time" TEXT,
    "sceneId" TEXT,
    "isSelfTape" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditionActor" (
    "id" TEXT NOT NULL,
    "auditionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "characterId" TEXT,

    CONSTRAINT "AuditionActor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_kind_idx" ON "ProjectFile"("projectId", "kind");

-- CreateIndex
CREATE INDEX "ProjectFile_status_idx" ON "ProjectFile"("status");

-- CreateIndex
CREATE INDEX "Audition_projectId_date_idx" ON "Audition"("projectId", "date");

-- CreateIndex
CREATE INDEX "Audition_sceneId_idx" ON "Audition"("sceneId");

-- CreateIndex
CREATE INDEX "Audition_videoFileId_idx" ON "Audition"("videoFileId");

-- CreateIndex
CREATE INDEX "AuditionActor_personId_idx" ON "AuditionActor"("personId");

-- CreateIndex
CREATE INDEX "AuditionActor_characterId_idx" ON "AuditionActor"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditionActor_auditionId_personId_key" ON "AuditionActor"("auditionId", "personId");

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audition" ADD CONSTRAINT "Audition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audition" ADD CONSTRAINT "Audition_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "ProjectFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audition" ADD CONSTRAINT "Audition_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audition" ADD CONSTRAINT "Audition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditionActor" ADD CONSTRAINT "AuditionActor_auditionId_fkey" FOREIGN KEY ("auditionId") REFERENCES "Audition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditionActor" ADD CONSTRAINT "AuditionActor_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CastingPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditionActor" ADD CONSTRAINT "AuditionActor_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
