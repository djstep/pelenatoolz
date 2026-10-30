"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createDepartmentBudgetAction } from "@/features/smeta/actions";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

/** «Создать смету» — только у главы цеха. Книга создаётся из встроенного шаблона. */
export function CreateDepartmentBudgetButton({
  projectId,
  departmentId,
  href,
}: {
  projectId: string;
  departmentId: string;
  href: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      className="h-8"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await createDepartmentBudgetAction(projectId, departmentId);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          router.push(href);
          router.refresh();
        })
      }
    >
      {pending ? "Создание…" : "Создать смету"}
    </Button>
  );
}
