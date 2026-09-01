-- CreateTable
CREATE TABLE "ResourceCategory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fillInScenes" BOOLEAN NOT NULL DEFAULT true,
    "perShift" BOOLEAN NOT NULL DEFAULT false,
    "countable" BOOLEAN NOT NULL DEFAULT false,
    "showInKpp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResourceItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "shiftRate" DECIMAL(12,2),
    "shiftHoursMin" INTEGER,
    "unpaidOvertimeMin" INTEGER,
    "arrivalOffsetMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SceneResourceItem" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SceneResourceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShootDayResourceUsage" (
    "id" TEXT NOT NULL,
    "shootDayId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT true,
    "arrivalTime" TEXT,

    CONSTRAINT "ShootDayResourceUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceCategory_projectId_name_key" ON "ResourceCategory"("projectId", "name");
CREATE INDEX "ResourceCategory_projectId_sortOrder_idx" ON "ResourceCategory"("projectId", "sortOrder");
CREATE UNIQUE INDEX "ResourceItem_categoryId_name_key" ON "ResourceItem"("categoryId", "name");
CREATE INDEX "ResourceItem_categoryId_idx" ON "ResourceItem"("categoryId");
CREATE UNIQUE INDEX "SceneResourceItem_sceneId_itemId_key" ON "SceneResourceItem"("sceneId", "itemId");
CREATE INDEX "SceneResourceItem_itemId_idx" ON "SceneResourceItem"("itemId");
CREATE UNIQUE INDEX "ShootDayResourceUsage_shootDayId_itemId_key" ON "ShootDayResourceUsage"("shootDayId", "itemId");

ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResourceItem" ADD CONSTRAINT "ResourceItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SceneResourceItem" ADD CONSTRAINT "SceneResourceItem_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SceneResourceItem" ADD CONSTRAINT "SceneResourceItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ResourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShootDayResourceUsage" ADD CONSTRAINT "ShootDayResourceUsage_shootDayId_fkey" FOREIGN KEY ("shootDayId") REFERENCES "ShootDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShootDayResourceUsage" ADD CONSTRAINT "ShootDayResourceUsage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ResourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
