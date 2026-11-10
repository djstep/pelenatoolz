-- Цех в приглашении: приняв приглашение, человек становится главой этого цеха (смета своего цеха).
-- Необязательное поле; цех удалён — поле очищается, приглашение остаётся. Данные не меняются.

-- AlterTable
ALTER TABLE "ProjectInvite" ADD COLUMN     "departmentId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectInvite_departmentId_idx" ON "ProjectInvite"("departmentId");

-- AddForeignKey
ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
