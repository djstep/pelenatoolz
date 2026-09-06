"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createBudgetFromTemplateAction,
  deleteBudgetTemplateAction,
  renameBudgetTemplateAction,
  saveBudgetAsTemplateAction,
} from "@/features/smeta/actions";
import type {
  BudgetListItem,
  BudgetTemplateListItem,
} from "@/features/smeta/queries";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

export function SmetaTemplatesWorkspace({
  projectId,
  templates,
  budgets,
  canWrite,
}: {
  projectId: string;
  templates: BudgetTemplateListItem[];
  budgets: BudgetListItem[];
  canWrite: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const params = useParams();
  const locale = String(params.locale ?? "ru");
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState<BudgetTemplateListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingFrom, setSavingFrom] = useState(false);
  const [sourceBudgetId, setSourceBudgetId] = useState(budgets[0]?.id ?? "");
  const [newTemplateName, setNewTemplateName] = useState("");

  const builtin = templates.filter((t) => t.isBuiltin);
  const custom = templates.filter((t) => !t.isBuiltin);

  return (
    <div className="space-y-6">
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={budgets.length === 0}
            onClick={() => {
              setSourceBudgetId(budgets[0]?.id ?? "");
              setNewTemplateName(
                budgets[0] ? `${budgets[0].name} (шаблон)` : "Новый шаблон",
              );
              setSavingFrom(true);
            }}
          >
            Сохранить смету как шаблон
          </Button>
          <Link href={`/${locale}/projects/${projectId}/smeta?create=1`}>
            <Button type="button" variant="secondary">
              Создать смету из шаблона
            </Button>
          </Link>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-semibold">Встроенные</h3>
          <p className="mt-1 text-xs text-[var(--muted-fg)]">
            Стандартный отраслевой шаблон — нельзя удалить или переименовать.
          </p>
        </div>
        <ul>
          {builtin.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)]/60 px-4 py-3 last:border-0"
            >
              <div>
                <div className="font-medium">{t.name}</div>
                {t.description ? (
                  <div className="text-xs text-[var(--muted-fg)]">
                    {t.description}
                  </div>
                ) : null}
              </div>
              {canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      const res = await createBudgetFromTemplateAction(
                        projectId,
                        { templateId: t.id },
                      );
                      if (res.error) {
                        toast.error(res.error);
                        return;
                      }
                      toast.success(res.success ?? "Создано");
                      if (res.budgetId) {
                        router.push(
                          `/${locale}/projects/${projectId}/smeta?budgetId=${res.budgetId}`,
                        );
                        router.refresh();
                      }
                    });
                  }}
                >
                  Создать смету
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-semibold">Мои шаблоны</h3>
          <p className="mt-1 text-xs text-[var(--muted-fg)]">
            Сохранённые копии смет проекта.
          </p>
        </div>
        {custom.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted-fg)]">
            Пока нет своих шаблонов. Сохраните текущую смету как шаблон.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Обновлён</th>
                {canWrite ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {custom.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {t.updatedAt
                      ? formatDateShort(t.updatedAt)
                      : t.createdAt
                        ? formatDateShort(t.createdAt)
                        : "—"}
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => {
                            start(async () => {
                              const res = await createBudgetFromTemplateAction(
                                projectId,
                                { templateId: t.id, name: t.name },
                              );
                              if (res.error) {
                                toast.error(res.error);
                                return;
                              }
                              if (res.budgetId) {
                                router.push(
                                  `/${locale}/projects/${projectId}/smeta?budgetId=${res.budgetId}`,
                                );
                                router.refresh();
                              }
                            });
                          }}
                        >
                          Создать смету
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setRenaming(t);
                            setRenameValue(t.name);
                          }}
                        >
                          Переименовать
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={pending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Удалить шаблон «${t.name}»?`,
                              )
                            ) {
                              return;
                            }
                            start(async () => {
                              const res = await deleteBudgetTemplateAction(
                                projectId,
                                t.id,
                              );
                              if (res.error) toast.error(res.error);
                              else {
                                toast.success(res.success ?? "Удалено");
                                router.refresh();
                              }
                            });
                          }}
                        >
                          Удалить
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Modal
        open={renaming != null}
        onClose={() => setRenaming(null)}
        title="Переименование шаблона"
        footer={
          <div className="flex gap-3">
            <Button
              type="button"
              disabled={pending || !renameValue.trim()}
              onClick={() => {
                if (!renaming) return;
                start(async () => {
                  const res = await renameBudgetTemplateAction(
                    projectId,
                    renaming.id,
                    { name: renameValue.trim() },
                  );
                  if (res.error) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(res.success ?? "Сохранено");
                  setRenaming(null);
                  router.refresh();
                });
              }}
            >
              {pending ? "…" : "Сохранить"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRenaming(null)}
            >
              Отмена
            </Button>
          </div>
        }
      >
        <div>
          <Label htmlFor="tpl-rename">Название</Label>
          <Input
            id="tpl-rename"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={savingFrom}
        onClose={() => setSavingFrom(false)}
        title="Сохранить смету как шаблон"
        footer={
          <div className="flex gap-3">
            <Button
              type="button"
              disabled={
                pending || !sourceBudgetId || !newTemplateName.trim()
              }
              onClick={() => {
                start(async () => {
                  const res = await saveBudgetAsTemplateAction(
                    projectId,
                    sourceBudgetId,
                    { name: newTemplateName.trim() },
                  );
                  if (res.error) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(res.success ?? "Шаблон сохранён");
                  setSavingFrom(false);
                  router.refresh();
                });
              }}
            >
              {pending ? "…" : "Сохранить"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSavingFrom(false)}
            >
              Отмена
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div>
            <Label htmlFor="src-budget">Смета</Label>
            <Select
              id="src-budget"
              value={sourceBudgetId}
              onChange={(e) => {
                const id = e.target.value;
                setSourceBudgetId(id);
                const b = budgets.find((x) => x.id === id);
                if (b) setNewTemplateName(`${b.name} (шаблон)`);
              }}
            >
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tpl-name">Название шаблона</Label>
            <Input
              id="tpl-name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
