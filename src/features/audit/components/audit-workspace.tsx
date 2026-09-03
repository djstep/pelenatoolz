"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { AuditAction } from "@prisma/client";
import {
  formatAuditValue,
  parseAuditChanges,
} from "@/features/audit/lib/format-changes";
import type { AuditLogRow } from "@/features/audit/queries";
import { auditEntityLabel } from "@/shared/audit/entity-types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

const actionLabels: Record<AuditAction, string> = {
  CREATE: "Создание",
  UPDATE: "Изменение",
  DELETE: "Удаление",
};

type Props = {
  locale: string;
  projectId: string;
  rows: AuditLogRow[];
  total: number;
  page: number;
  totalPages: number;
  entityTypes: string[];
  users: { id: string; name: string; email: string }[];
  filters: {
    entityType: string;
    action: string;
    userId: string;
    dateFrom: string;
    dateTo: string;
    search: string;
  };
};

function buildQuery(
  base: string,
  params: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
) {
  const url = new URL(base, "http://local");
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!v) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  return url.pathname + url.search;
}

export function AuditWorkspace({
  locale,
  projectId,
  rows,
  total,
  page,
  totalPages,
  entityTypes,
  users,
  filters,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const basePath = `/${locale}/projects/${projectId}/audit`;

  const navigate = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = buildQuery(basePath, Object.fromEntries(searchParams.entries()), {
        ...patch,
        page: patch.page ?? (patch.entityType || patch.action || patch.userId || patch.search ? "1" : undefined),
      });
      startTransition(() => router.push(next));
    },
    [basePath, router, searchParams],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Журнал изменений</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Кто, что и когда менял в проекте. Всего записей: {total}.
        </p>
      </div>

      <form
        className="glass-card grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          navigate({
            entityType: String(fd.get("entityType") || ""),
            action: String(fd.get("action") || ""),
            userId: String(fd.get("userId") || ""),
            dateFrom: String(fd.get("dateFrom") || ""),
            dateTo: String(fd.get("dateTo") || ""),
            search: String(fd.get("search") || ""),
            page: "1",
          });
        }}
      >
        <div>
          <Label htmlFor="search">Поиск</Label>
          <Input
            id="search"
            name="search"
            defaultValue={filters.search}
            placeholder="По описанию…"
          />
        </div>
        <div>
          <Label htmlFor="entityType">Сущность</Label>
          <Select id="entityType" name="entityType" defaultValue={filters.entityType}>
            <option value="">Все</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {auditEntityLabel(t)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="action">Действие</Label>
          <Select id="action" name="action" defaultValue={filters.action}>
            <option value="">Все</option>
            {(Object.keys(actionLabels) as AuditAction[]).map((a) => (
              <option key={a} value={a}>
                {actionLabels[a]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="userId">Пользователь</Label>
          <Select id="userId" name="userId" defaultValue={filters.userId}>
            <option value="">Все</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dateFrom">С даты</Label>
          <Input id="dateFrom" name="dateFrom" type="date" defaultValue={filters.dateFrom} />
        </div>
        <div>
          <Label htmlFor="dateTo">По дату</Label>
          <Input id="dateTo" name="dateTo" type="date" defaultValue={filters.dateTo} />
        </div>
        <div className="flex items-end gap-2 lg:col-span-6">
          <Button type="submit" disabled={pending}>
            {pending ? "…" : "Применить"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(basePath)}
          >
            Сбросить
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Записей не найдено.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((log) => {
            const diffs = parseAuditChanges(log.changes);
            return (
              <article
                key={log.id}
                className="glass-card space-y-2 p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {actionLabels[log.action]} · {auditEntityLabel(log.entityType)}
                    </p>
                    <p className="text-[var(--muted-fg)]">
                      {log.summary || "—"}
                    </p>
                  </div>
                  <time className="text-xs text-[var(--muted-fg)] whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("ru-RU")}
                  </time>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-fg)]">
                  <span>{log.user.name}</span>
                  <span>{log.user.email}</span>
                  <span className="font-mono">{log.entityId}</span>
                </div>
                {diffs && diffs.length > 0 ? (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-[var(--muted-fg)]">
                        <th className="py-1 pr-3">Поле</th>
                        <th className="py-1 pr-3">Было</th>
                        <th className="py-1">Стало</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffs.map((d) => (
                        <tr key={d.field} className="border-t border-[var(--border)]/40">
                          <td className="py-1 pr-3 font-medium">{d.field}</td>
                          <td className="py-1 pr-3 text-[var(--muted-fg)]">
                            {formatAuditValue(d.before)}
                          </td>
                          <td className="py-1">{formatAuditValue(d.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1 || pending}
            onClick={() => navigate({ page: String(page - 1) })}
          >
            ← Назад
          </Button>
          <span className="text-sm text-[var(--muted-fg)]">
            Стр. {page} из {totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= totalPages || pending}
            onClick={() => navigate({ page: String(page + 1) })}
          >
            Вперёд →
          </Button>
        </div>
      ) : null}
    </div>
  );
}
