-- Волна 4, шаг 5: статус «вырезана» у сцены и титульная страница у версии сценария.
-- Два пустых необязательных поля, существующие данные не меняются.

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN "cutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScriptVersion" ADD COLUMN "titlePage" JSONB;
