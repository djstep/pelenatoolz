-- CreateEnum
CREATE TYPE "ScriptCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "ScriptBlock" ADD COLUMN "contentHtml" TEXT;

-- CreateTable
CREATE TABLE "ScriptComment" (
    "id" TEXT NOT NULL,
    "scriptVersionId" TEXT NOT NULL,
    "startBlockId" TEXT NOT NULL,
    "endBlockId" TEXT NOT NULL,
    "rangeStart" INTEGER NOT NULL DEFAULT 0,
    "rangeEnd" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "status" "ScriptCommentStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptComment_scriptVersionId_idx" ON "ScriptComment"("scriptVersionId");
CREATE INDEX "ScriptComment_startBlockId_idx" ON "ScriptComment"("startBlockId");
CREATE INDEX "ScriptComment_authorId_idx" ON "ScriptComment"("authorId");
CREATE INDEX "ScriptComment_parentCommentId_idx" ON "ScriptComment"("parentCommentId");

-- AddForeignKey
ALTER TABLE "ScriptComment" ADD CONSTRAINT "ScriptComment_scriptVersionId_fkey" FOREIGN KEY ("scriptVersionId") REFERENCES "ScriptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScriptComment" ADD CONSTRAINT "ScriptComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScriptComment" ADD CONSTRAINT "ScriptComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "ScriptComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
