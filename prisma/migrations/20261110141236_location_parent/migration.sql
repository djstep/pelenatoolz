-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Location_parentId_sortOrder_idx" ON "Location"("parentId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
