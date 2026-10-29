-- Удаление проекта целиком не проходило: связь строки версии со статьёй (NO ACTION)
-- проверялась раньше, чем каскад удалял строки версии. Теперь связь каскадная,
-- а триггер строки пропускает удаление, только если проекта версии уже нет.

-- DropForeignKey
ALTER TABLE "BudgetVersionLine" DROP CONSTRAINT "BudgetVersionLine_budgetItemId_fkey";

-- AddForeignKey
ALTER TABLE "BudgetVersionLine" ADD CONSTRAINT "BudgetVersionLine_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "budget_version_line_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "BudgetVersion" v
    JOIN "Project" p ON p."id" = v."projectId"
    WHERE v."id" = OLD."versionId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Строка утверждённой версии сметы не изменяется и не удаляется';
END;
$$ LANGUAGE plpgsql;
