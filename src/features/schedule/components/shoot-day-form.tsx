"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import { ShootDayStatus } from "@prisma/client";
import {
  createShootDayAction,
  type ActionState,
} from "@/features/schedule/actions";
import { countCalendarDays, parseDateInput } from "@/features/schedule/lib/date-range";
import { shootDayStatusLabels } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

const initial: ActionState = {};

const labelClass =
  "mb-0 block h-5 text-xs font-medium leading-5 text-[var(--muted-fg)]";
const fieldClass = "h-10 py-2";
const dateFieldClass =
  "h-10 w-[7.25rem] shrink-0 [&_button]:h-10 [&_button]:py-2 [&_button]:text-xs";

function FieldColumn({
  label,
  labelFor,
  className,
  children,
}: {
  label: string;
  labelFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col gap-1.5", className)}>
      <Label htmlFor={labelFor} className={labelClass}>{label}</Label>
      {children}
    </div>
  );
}

export function ShootDayForm({
  projectId,
  nextDayNumber,
  canWrite,
}: {
  projectId: string;
  nextDayNumber: number;
  canWrite: boolean;
}) {
  const bound = createShootDayAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const dayCount = useMemo(() => {
    if (!dateFrom) return 1;
    const from = parseDateInput(dateFrom);
    const to = parseDateInput(dateTo || dateFrom);
    if (!from || !to || to < from) return 1;
    return countCalendarDays(from, to);
  }, [dateFrom, dateTo]);

  if (!canWrite) return null;

  return (
    <form
      action={action}
      className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-3"
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <FieldColumn label="День №" labelFor="dayNumber" className="w-[4.5rem]">
          <Input
            id="dayNumber"
            name="dayNumber"
            type="number"
            min={1}
            defaultValue={nextDayNumber}
            required
            className={fieldClass}
          />
        </FieldColumn>

        <FieldColumn label="Период" className="w-[15.75rem]">
          <div className="flex h-10 items-center gap-1">
            <Input
              id="dateFrom"
              name="dateFrom"
              type="date"
              required
              value={dateFrom}
              placeholder="с"
              onChange={(e) => setDateFrom(e.target.value)}
              className={dateFieldClass}
              aria-label="Дата начала"
            />
            <span className="shrink-0 px-0.5 text-xs text-[var(--muted-fg)]">—</span>
            <Input
              id="dateTo"
              name="dateTo"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              placeholder="по"
              onChange={(e) => setDateTo(e.target.value)}
              className={dateFieldClass}
              aria-label="Дата окончания"
            />
          </div>
        </FieldColumn>

        <FieldColumn label="Сбор" labelFor="callTime" className="w-[5rem]">
          <Input
            id="callTime"
            name="callTime"
            placeholder="08:00"
            className={fieldClass}
          />
        </FieldColumn>

        <FieldColumn label="Конец" labelFor="wrapTime" className="w-[5rem]">
          <Input
            id="wrapTime"
            name="wrapTime"
            placeholder="20:00"
            className={fieldClass}
          />
        </FieldColumn>

        <FieldColumn label="Заметки" labelFor="notes" className="min-w-[10rem] flex-1">
          <Input id="notes" name="notes" className={fieldClass} />
        </FieldColumn>

        <FieldColumn label="Статус" labelFor="status" className="w-[7rem]">
          <Select
            id="status"
            name="status"
            defaultValue={ShootDayStatus.PLANNED}
            className="[&_.glass-select-trigger]:h-10 [&_.glass-select-trigger]:py-2"
          >
            {Object.values(ShootDayStatus).map((s) => (
              <option key={s} value={s}>
                {shootDayStatusLabels[s]}
              </option>
            ))}
          </Select>
        </FieldColumn>

        <Button type="submit" disabled={pending} className="h-10 shrink-0 px-4 py-0">
          {pending ? "…" : dayCount === 1 ? "Добавить день" : `Добавить ${dayCount} дней`}
        </Button>
      </div>

      {state.error ? (
        <p className="mt-2 text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="mt-2 text-sm text-emerald-300">{state.success}</p>
      ) : null}
    </form>
  );
}
