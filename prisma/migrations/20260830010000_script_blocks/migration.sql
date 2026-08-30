-- CreateEnum
CREATE TYPE "ScriptBlockType" AS ENUM (
  'SLUGLINE',
  'SCENE_CAST',
  'ACTION',
  'CHARACTER',
  'DIALOGUE',
  'PARENTHETICAL',
  'SUPER',
  'TRANSITION',
  'NOTE',
  'BONEYARD',
  'SCENE_GROUP',
  'FOLDER'
);

-- CreateTable
CREATE TABLE "ScriptBlock" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sceneId" TEXT,
  "type" "ScriptBlockType" NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScriptBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptBlock_projectId_sortOrder_idx" ON "ScriptBlock"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ScriptBlock_sceneId_idx" ON "ScriptBlock"("sceneId");

-- AddForeignKey
ALTER TABLE "ScriptBlock" ADD CONSTRAINT "ScriptBlock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptBlock" ADD CONSTRAINT "ScriptBlock_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
