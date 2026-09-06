"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  createBlankBudgetAction,
  createBudgetFromTemplateAction,
  importBudgetWorkbookFileAction,
} from "@/features/smeta/actions";
import type { BudgetTemplateListItem } from "@/features/smeta/queries";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useToast } from "@/shared/ui/toast";

type Mode = "choose" | "blank" | "template" | "excel";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function CreateSmetaWizard({
  projectId,
  templates,
  canWrite,
  cancelHref,
}: {
  projectId: string;
  templates: BudgetTemplateListItem[];
  canWrite: boolean;
  cancelHref?: string;
}) {
  const router = useRouter();
  const params = useParams();
  const locale = String(params.locale ?? "ru");
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("choose");
  const [name, setName] = useState("Смета");
  const [templateId, setTemplateId] = useState(
    templates[0]?.id ?? "builtin:industry",
  );
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function goToBudget(budgetId: string) {
    router.push(`/${locale}/projects/${projectId}/smeta?budgetId=${budgetId}`);
    router.refresh();
  }

  if (!canWrite) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Смет пока нет. Нужны права на запись, чтобы создать первую.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-6">
      <div>
        <h3 className="font-display text-xl font-semibold">Новая смета</h3>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Выберите способ создания: пустая книга, шаблон или импорт Excel.
        </p>
      </div>

      {mode === "choose" ? (
        <div className="grid gap-3">
          <button
            type="button"
            className="rounded-xl border border-[var(--border)] px-4 py-3 text-left transition hover:bg-white/5"
            onClick={() => setMode("blank")}
          >
            <div className="font-medium">С нуля</div>
            <div className="text-xs text-[var(--muted-fg)]">
              Пустая таблица с заголовками статей
            </div>
          </button>
          <button
            type="button"
            className="rounded-xl border border-[var(--border)] px-4 py-3 text-left transition hover:bg-white/5"
            onClick={() => setMode("template")}
          >
            <div className="font-medium">Из шаблона</div>
            <div className="text-xs text-[var(--muted-fg)]">
              Отраслевой шаблон или сохранённые вами
            </div>
          </button>
          <button
            type="button"
            className="rounded-xl border border-[var(--border)] px-4 py-3 text-left transition hover:bg-white/5"
            onClick={() => setMode("excel")}
          >
            <div className="font-medium">Импорт Excel / CSV</div>
            <div className="text-xs text-[var(--muted-fg)]">
              Загрузить существующий файл сметы
            </div>
          </button>
          {cancelHref ? (
            <Link href={cancelHref}>
              <Button type="button" variant="secondary" className="w-full">
                Отмена
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}

      {mode === "blank" || mode === "template" ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="smeta-name">Название</Label>
            <Input
              id="smeta-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {mode === "template" ? (
            <div className="space-y-2">
              <Label>Шаблон</Label>
              <div className="grid gap-2">
                {templates.map((t) => (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${
                      templateId === t.id
                        ? "border-[var(--foreground)]/40 bg-white/5"
                        : "border-[var(--border)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      checked={templateId === t.id}
                      onChange={() => setTemplateId(t.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{t.name}</span>
                      {t.isBuiltin ? (
                        <span className="ml-2 text-[10px] text-[var(--muted-fg)]">
                          встроенный
                        </span>
                      ) : null}
                      {t.description ? (
                        <span className="mt-0.5 block text-xs text-[var(--muted-fg)]">
                          {t.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() => {
                startTransition(async () => {
                  const res =
                    mode === "blank"
                      ? await createBlankBudgetAction(projectId, {
                          name: name.trim(),
                        })
                      : await createBudgetFromTemplateAction(projectId, {
                          templateId,
                          name: name.trim(),
                        });
                  if (res.error) {
                    toast.error(res.error);
                    return;
                  }
                  if (res.budgetId) goToBudget(res.budgetId);
                });
              }}
            >
              {pending ? "…" : "Создать"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMode("choose")}
            >
              Назад
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "excel" ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="smeta-import-name">Название (необязательно)</Label>
            <Input
              id="smeta-import-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Из имени файла"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              startTransition(async () => {
                try {
                  const base64 = await fileToBase64(file);
                  const res = await importBudgetWorkbookFileAction(projectId, {
                    fileName: file.name,
                    base64,
                    name: name.trim() || undefined,
                  });
                  if (res.error) {
                    toast.error(res.error);
                    return;
                  }
                  if (res.warnings?.length) {
                    toast.success(
                      res.warnings.map((w) => w.message).join("; "),
                    );
                  }
                  if (res.budgetId) goToBudget(res.budgetId);
                } catch {
                  toast.error("Не удалось прочитать файл");
                }
              });
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              {pending ? "…" : "Выбрать файл"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMode("choose")}
            >
              Назад
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
