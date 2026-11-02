"use client";

import { useTransition } from "react";
import { exportDepartmentBudgetAction } from "@/features/smeta/export-actions";
import { downloadBase64Xlsx } from "@/features/smeta/lib/download-xlsx";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

/**
 * «Экспорт Excel» сметы цеха: основной лист + «О выгрузке». Без `version` — утверждена →
 * последняя утверждённая, иначе текущий лист. `beforeExport` — досохранить правки главы
 * (false — не выгружать: в файл ушло бы не то, что на экране).
 */
export function BudgetExcelExportButton({
  projectId,
  departmentId,
  version,
  beforeExport,
  className,
}: {
  projectId: string;
  departmentId: string;
  version?: number;
  beforeExport?: () => Promise<boolean>;
  className?: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      disabled={pending}
      title="Основной лист сметы и лист «О выгрузке». Черновые листы не выгружаются."
      onClick={() => {
        start(async () => {
          if (beforeExport && !(await beforeExport())) {
            toast.error("Сначала должны сохраниться правки — Excel не выгружен");
            return;
          }
          const res = await exportDepartmentBudgetAction(projectId, departmentId, { version });
          if (res.error !== undefined) {
            toast.error(res.error);
            return;
          }
          downloadBase64Xlsx(res.base64, res.fileName);
          toast.success("Excel скачан");
        });
      }}
    >
      {pending ? "…" : "Экспорт Excel"}
    </Button>
  );
}
