-- CreateTable
CREATE TABLE "EstimateWorkbook" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Смета',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "EstimateWorkbook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstimateWorkbook_projectId_idx" ON "EstimateWorkbook"("projectId");

-- AddForeignKey
ALTER TABLE "EstimateWorkbook" ADD CONSTRAINT "EstimateWorkbook_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateWorkbook" ADD CONSTRAINT "EstimateWorkbook_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
