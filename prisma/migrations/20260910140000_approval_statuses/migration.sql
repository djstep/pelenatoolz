-- CreateTable
CREATE TABLE "ProjectApprovalStatus" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectApprovalStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectApprovalStatus_projectId_sortOrder_idx" ON "ProjectApprovalStatus"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApprovalStatus_projectId_name_key" ON "ProjectApprovalStatus"("projectId", "name");

-- AddForeignKey
ALTER TABLE "ProjectApprovalStatus" ADD CONSTRAINT "ProjectApprovalStatus_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
