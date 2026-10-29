-- Цеха проекта и их главы (волна 2, шаг 1).

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentHead" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentHead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Department_projectId_sortOrder_idx" ON "Department"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Department_projectId_name_key" ON "Department"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_projectId_codePrefix_key" ON "Department"("projectId", "codePrefix");

-- CreateIndex
CREATE INDEX "DepartmentHead_membershipId_idx" ON "DepartmentHead"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentHead_departmentId_membershipId_key" ON "DepartmentHead"("departmentId", "membershipId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentHead" ADD CONSTRAINT "DepartmentHead_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentHead" ADD CONSTRAINT "DepartmentHead_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ProjectMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

