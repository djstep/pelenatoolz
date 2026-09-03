-- AlterTable
ALTER TABLE "CastingPerson" ADD COLUMN "birthDate" DATE,
ADD COLUMN "education" TEXT,
ADD COLUMN "filmography" TEXT;

-- AlterTable
ALTER TABLE "Audition" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CastingCandidateComment" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CastingCandidateComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CastingCandidateComment_candidateId_createdAt_idx" ON "CastingCandidateComment"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "CastingCandidateComment_authorId_idx" ON "CastingCandidateComment"("authorId");

-- AddForeignKey
ALTER TABLE "CastingCandidateComment" ADD CONSTRAINT "CastingCandidateComment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CastingCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CastingCandidateComment" ADD CONSTRAINT "CastingCandidateComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
