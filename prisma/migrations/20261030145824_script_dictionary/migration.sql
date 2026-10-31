-- Волна 4, шаг 3: словарь импорта сценария — ответы на постоянные вопросы экрана проверки.
-- Новая пустая таблица, существующие данные не меняются. Тип правила — строка, не перечисление.
-- Цель правила — персонаж или локация проекта; запись удалена — цель пустая, правило устарело.

-- CreateTable
CREATE TABLE "ScriptDictionaryRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "targetCharacterId" TEXT,
    "targetLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptDictionaryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptDictionaryRule_projectId_idx" ON "ScriptDictionaryRule"("projectId");

-- CreateIndex
CREATE INDEX "ScriptDictionaryRule_targetCharacterId_idx" ON "ScriptDictionaryRule"("targetCharacterId");

-- CreateIndex
CREATE INDEX "ScriptDictionaryRule_targetLocationId_idx" ON "ScriptDictionaryRule"("targetLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptDictionaryRule_projectId_type_key_key" ON "ScriptDictionaryRule"("projectId", "type", "key");

-- AddForeignKey
ALTER TABLE "ScriptDictionaryRule" ADD CONSTRAINT "ScriptDictionaryRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptDictionaryRule" ADD CONSTRAINT "ScriptDictionaryRule_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptDictionaryRule" ADD CONSTRAINT "ScriptDictionaryRule_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
