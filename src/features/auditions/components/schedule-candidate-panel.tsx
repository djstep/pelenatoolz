"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { ActorRoleType } from "@prisma/client";
import { useMemo, useState, useTransition } from "react";
import { updateCastingCandidateRatingAction } from "@/features/auditions/actions-schedule";
import type { ScheduleCandidateCard } from "@/features/auditions/lib/schedule-shared";
import { actorRoleTypeLabels } from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

function Stars({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange?: (n: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled || !onChange}
          className={cn(
            "text-xs leading-none",
            (value ?? 0) >= n ? "text-amber-400" : "text-[var(--muted-fg)]/40",
            onChange && !disabled && "cursor-pointer hover:text-amber-300",
          )}
          onClick={() => onChange?.(value === n ? null : n)}
          aria-label={`${n} из 5`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function CandidateCard({
  card,
  projectId,
  canWrite,
  size = "sm",
}: {
  card: ScheduleCandidateCard;
  projectId: string;
  canWrite: boolean;
  size?: "sm" | "lg";
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `cand-${card.id}`,
      data: { castingCandidateId: card.id },
      disabled: !canWrite,
    });

  const muted = Boolean(card.nextCall);
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
  };
  const photoClass = size === "lg" ? "h-14 w-14" : "h-10 w-10";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)]",
        size === "lg" ? "p-3" : "p-2",
        muted && "opacity-70",
        isDragging && "z-20 shadow-lg",
        canWrite && "cursor-grab active:cursor-grabbing",
      )}
      {...listeners}
      {...attributes}
    >
      <div
        className={cn(
          "shrink-0 overflow-hidden rounded-full bg-[var(--surface-2)]",
          photoClass,
        )}
      >
        {card.person.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.person.photoUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-fg)]">
            ?
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p
            className={cn(
              "truncate font-medium",
              size === "lg" ? "text-base" : "text-sm",
            )}
          >
            {card.person.label}
          </p>
          {card.hasTape ? (
            <span
              className="shrink-0 text-[var(--accent)]"
              title="Есть записанная проба"
              aria-label="Есть проба"
            >
              ▶
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            "truncate text-[var(--muted-fg)]",
            size === "lg" ? "text-sm" : "text-xs",
          )}
        >
          {card.character.name}
          {card.character.roleType
            ? ` · ${actorRoleTypeLabels[card.character.roleType]}`
            : ""}
        </p>
        {card.nextCall ? (
          <p className="text-[10px] text-[var(--muted-fg)]">
            Вызов {formatDateShort(card.nextCall.dateKey)} · {card.nextCall.time}
          </p>
        ) : null}
        <Stars
          value={card.rating}
          disabled={!canWrite || pending}
          onChange={
            canWrite
              ? (n) => {
                  start(async () => {
                    const r = await updateCastingCandidateRatingAction(
                      projectId,
                      card.id,
                      n,
                    );
                    if (r.error) toast.error(r.error);
                  });
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

export function ScheduleCandidatePanel({
  projectId,
  candidates,
  characters,
  canWrite,
  size = "sm",
}: {
  projectId: string;
  candidates: ScheduleCandidateCard[];
  characters: { id: string; name: string }[];
  canWrite: boolean;
  size?: "sm" | "lg";
}) {
  const [q, setQ] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [roleType, setRoleType] = useState<ActorRoleType | "ALL">("ALL");
  const [ratingMin, setRatingMin] = useState(0);
  const [callFilter, setCallFilter] = useState<"ALL" | "never" | "called">(
    "ALL",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return candidates.filter((c) => {
      if (qq) {
        const blob = `${c.person.label} ${c.character.name}`.toLowerCase();
        if (!blob.includes(qq)) return false;
      }
      if (characterId && c.character.id !== characterId) return false;
      if (roleType !== "ALL" && c.character.roleType !== roleType) return false;
      if (ratingMin > 0 && (c.rating ?? 0) < ratingMin) return false;
      if (callFilter === "never" && c.wasCalled) return false;
      if (callFilter === "called" && !c.wasCalled) return false;
      return true;
    });
  }, [candidates, q, characterId, roleType, ratingMin, callFilter]);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-3 lg:shrink-0",
        size === "lg" ? "lg:w-80" : "lg:w-72",
      )}
    >
      <div>
        <h3 className="text-sm font-semibold">Актёры и персонажи</h3>
        <p className="text-xs text-[var(--muted-fg)]">
          Перетащите карточку на дату/время
        </p>
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск…"
      />
      <button
        type="button"
        className="text-left text-xs text-[var(--accent)]"
        onClick={() => setFiltersOpen((v) => !v)}
      >
        {filtersOpen ? "Скрыть фильтры" : "Расширенные фильтры"}
      </button>
      {filtersOpen ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <div>
            <Label>Персонаж</Label>
            <Select
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
            >
              <option value="">Все</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Тип роли</Label>
            <Select
              value={roleType}
              onChange={(e) =>
                setRoleType(e.target.value as ActorRoleType | "ALL")
              }
            >
              <option value="ALL">Все</option>
              {(Object.keys(actorRoleTypeLabels) as ActorRoleType[]).map(
                (k) => (
                  <option key={k} value={k}>
                    {actorRoleTypeLabels[k]}
                  </option>
                ),
              )}
            </Select>
          </div>
          <div>
            <Label>Оценка от</Label>
            <Select
              value={String(ratingMin)}
              onChange={(e) => setRatingMin(Number(e.target.value))}
            >
              <option value="0">Любая</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Вызовы</Label>
            <Select
              value={callFilter}
              onChange={(e) =>
                setCallFilter(e.target.value as "ALL" | "never" | "called")
              }
            >
              <option value="ALL">Все</option>
              <option value="never">Ещё не вызывались</option>
              <option value="called">Уже вызывались ранее</option>
            </Select>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Нет кандидатов</p>
        ) : (
          filtered.map((c) => (
            <CandidateCard
              key={c.id}
              card={c}
              projectId={projectId}
              canWrite={canWrite}
              size={size}
            />
          ))
        )}
      </div>
    </aside>
  );
}
