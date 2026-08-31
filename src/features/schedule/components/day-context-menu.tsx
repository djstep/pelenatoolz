"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  clearShootDayAction,
  deleteShootDayWithShiftAction,
  insertShootDayAfterAction,
  insertShootDayBeforeAction,
  updateShootDayAction,
} from "@/features/schedule/actions";
import { shootDayTypeLabels } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

export type MenuAnchor = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

type MenuDay = {
  id: string;
  dayNumber: number;
  date: Date;
  dayType: keyof typeof shootDayTypeLabels;
  isLocked: boolean;
  isNightShift: boolean;
  comment: string | null;
};

type DayType = keyof typeof shootDayTypeLabels;

const MENU_WIDTH = 280;
const DAY_TYPES = Object.entries(shootDayTypeLabels) as [DayType, string][];

function MenuItem({
  children,
  onClick,
  disabled,
  active,
  danger,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  icon?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-[var(--muted-fg)] opacity-50"
          : danger
            ? "text-red-300 hover:bg-red-500/15"
            : active
              ? "bg-[var(--accent)]/25 text-white"
              : "text-[var(--foreground)] hover:bg-white/10",
      )}
    >
      {icon ? (
        <span className="w-4 shrink-0 text-center text-xs opacity-80" aria-hidden>
          {icon}
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span className="flex-1">{children}</span>
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-[var(--border)]" />;
}

function clampMenuPosition(anchor: MenuAnchor, height: number) {
  const pad = 8;
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer to the right of the day column so the day stays visible
  let left = anchor.right + gap;
  if (left + MENU_WIDTH > vw - pad) {
    left = anchor.left - MENU_WIDTH - gap;
  }
  left = Math.max(pad, Math.min(left, vw - MENU_WIDTH - pad));

  let top = anchor.top;
  if (top + height > vh - pad) {
    top = vh - height - pad;
  }
  top = Math.max(pad, top);

  return { top, left };
}

export function DayContextMenu({
  projectId,
  locale,
  day,
  anchor,
  onClose,
}: {
  projectId: string;
  locale: string;
  day: MenuDay;
  anchor: MenuAnchor;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [pos, setPos] = useState(() => clampMenuPosition(anchor, 360));
  const [mode, setMode] = useState<"menu" | "move" | "comment">("menu");
  const [dateValue, setDateValue] = useState(
    new Date(day.date).toISOString().slice(0, 10),
  );
  const [comment, setComment] = useState(day.comment ?? "");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPos(clampMenuPosition(anchor, el.offsetHeight));
  }, [anchor, mode]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-transparent"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
        className="absolute z-10 max-h-[min(70vh,32rem)] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[#0c1220] shadow-2xl"
        role="menu"
      >
        <div className="border-b border-[var(--border)] px-3 py-2.5">
          <p className="text-sm font-semibold">День {day.dayNumber}</p>
          <p className="text-[11px] text-[var(--muted-fg)]">
            {new Date(day.date).toLocaleDateString("ru-RU", {
              weekday: "short",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>

        {mode === "menu" ? (
          <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
            <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-fg)]">
              Тип дня
            </p>
            {DAY_TYPES.map(([type, label]) => (
              <MenuItem
                key={type}
                icon={day.dayType === type ? "✓" : ""}
                active={day.dayType === type}
                disabled={busy}
                onClick={() =>
                  run(() =>
                    updateShootDayAction(projectId, day.id, { dayType: type }),
                  )
                }
              >
                {label}
              </MenuItem>
            ))}

            <Divider />

            <MenuItem
              icon="🔒"
              disabled={busy}
              onClick={() =>
                run(() =>
                  updateShootDayAction(projectId, day.id, {
                    isLocked: !day.isLocked,
                  }),
                )
              }
            >
              {day.isLocked ? "Снять фиксацию" : "Зафиксировать день"}
            </MenuItem>
            <MenuItem
              icon={day.isNightShift ? "☀" : "☾"}
              disabled={busy}
              onClick={() =>
                run(() =>
                  updateShootDayAction(projectId, day.id, {
                    isNightShift: !day.isNightShift,
                  }),
                )
              }
            >
              {day.isNightShift
                ? "Сделать дневной сменой"
                : "Сделать ночной сменой"}
            </MenuItem>
            <MenuItem icon="📅" disabled={busy} onClick={() => setMode("move")}>
              Перенести на другую дату
            </MenuItem>
            <MenuItem
              icon="⬅"
              disabled={busy}
              onClick={() =>
                run(() => insertShootDayBeforeAction(projectId, day.id))
              }
            >
              Вставить день (слева)
            </MenuItem>
            <MenuItem
              icon="➡"
              disabled={busy}
              onClick={() =>
                run(() => insertShootDayAfterAction(projectId, day.id))
              }
            >
              Вставить день (справа)
            </MenuItem>
            <MenuItem
              icon="⊘"
              disabled={busy}
              onClick={() => {
                if (
                  !confirm(
                    "Очистить день? Сцены вернутся в неспланированные.",
                  )
                ) {
                  return;
                }
                void run(() => clearShootDayAction(projectId, day.id));
              }}
            >
              Очистить день
            </MenuItem>
            <MenuItem
              icon="✕"
              danger
              disabled={busy}
              onClick={() => {
                if (
                  !confirm(
                    "Удалить день со сдвигом? Сцены дня станут неспланированными, номера дней сдвинутся.",
                  )
                ) {
                  return;
                }
                void run(() => deleteShootDayWithShiftAction(projectId, day.id));
              }}
            >
              Удалить день со сдвигом
            </MenuItem>

            <Divider />

            <MenuItem
              icon="📋"
              onClick={() => {
                onClose();
                router.push(
                  `/${locale}/projects/${projectId}/call-sheets/${day.id}`,
                );
              }}
            >
              Вызывной
            </MenuItem>
            <MenuItem
              icon="📊"
              onClick={() => {
                onClose();
                router.push(
                  `/${locale}/projects/${projectId}/reports/${day.id}`,
                );
              }}
            >
              Производственный отчёт
            </MenuItem>
            <MenuItem
              icon="👥"
              onClick={() => {
                onClose();
                router.push(
                  `/${locale}/projects/${projectId}/characters/employment/${day.id}`,
                );
              }}
            >
              Занятость актёров
            </MenuItem>
            <MenuItem icon="✎" disabled={busy} onClick={() => setMode("comment")}>
              Комментарий
              {day.comment ? "…" : ""}
            </MenuItem>
          </div>
        ) : null}

        {mode === "move" ? (
          <div className="space-y-3 p-3">
            <p className="text-sm font-medium">Новая дата</p>
            <Input
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                onClick={() => setMode("menu")}
              >
                Назад
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={busy || !dateValue}
                onClick={() =>
                  run(() =>
                    updateShootDayAction(projectId, day.id, {
                      date: dateValue,
                    }),
                  )
                }
              >
                Перенести
              </Button>
            </div>
          </div>
        ) : null}

        {mode === "comment" ? (
          <div className="space-y-3 p-3">
            <p className="text-sm font-medium">Комментарий к дню</p>
            <textarea
              className="glass-input min-h-[6rem] w-full rounded-xl px-3 py-2.5 text-sm"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Заметки по дню…"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                onClick={() => setMode("menu")}
              >
                Назад
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    updateShootDayAction(projectId, day.id, {
                      comment: comment.trim(),
                    }),
                  )
                }
              >
                Сохранить
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
