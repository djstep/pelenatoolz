"use client";

import { useState } from "react";
import type {
  ExistingRecords,
  NormalizedBlock,
  NormalizeQuestion,
} from "@/features/import/normalize/normalize-script";
import {
  acceptsCustomNumber,
  optionLabel,
  questionTitle,
  visibleOptions,
} from "@/features/import/review/question-text";
import { SCRIPT_BLOCK_LABELS } from "@/features/screenplay/lib/block-types";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

/** Постоянный вопрос — ответ запомнится в словаре проекта; разовый — только этот импорт. */
function KindBadge({ q }: { q: NormalizeQuestion }) {
  return q.persistent ? (
    <Badge className="border-[var(--accent)]/40 text-[var(--accent)]">
      запомнится для проекта
    </Badge>
  ) : (
    <Badge className="text-[var(--muted-fg)]">только этот импорт</Badge>
  );
}

export function QuestionCard({
  q,
  answered,
  existing,
  fileKeys,
  onAnswer,
}: {
  q: NormalizeQuestion;
  /** Ответ пользователя; пусто — действует предложенный. */
  answered: string | undefined;
  existing: ExistingRecords;
  fileKeys: ReadonlySet<string>;
  onAnswer: (value: string) => void;
}) {
  const custom = acceptsCustomNumber(q) && answered != null && !q.options.includes(answered);
  const [number, setNumber] = useState(custom ? answered : "");
  const unanswered = q.required && !answered;

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3",
        unanswered
          ? "border-[var(--danger)]/50 bg-[rgba(251,113,133,0.06)]"
          : answered != null
            ? "border-[var(--accent)]/30"
            : "border-[var(--border)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{questionTitle(q)}</p>
        <div className="flex flex-wrap gap-1.5">
          {q.required ? (
            <Badge className="text-[var(--danger)]">нужен ответ</Badge>
          ) : null}
          <KindBadge q={q} />
        </div>
      </div>
      {q.occurrences.length > 1 ? (
        <p className="text-xs text-[var(--muted-fg)]">Встречается {q.occurrences.length} раз</p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {visibleOptions(q).map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={`q:${q.code}`}
              value={option}
              checked={q.answer === option}
              onChange={() => onAnswer(option)}
              className="accent-[var(--accent)]"
            />
            {optionLabel(q, option, existing, fileKeys)}
            {option === q.suggested && answered == null ? (
              <span className="text-xs text-[var(--muted-fg)]">(предложено)</span>
            ) : null}
          </label>
        ))}
        {acceptsCustomNumber(q) ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={`q:${q.code}`}
              checked={custom}
              onChange={() => number && onAnswer(number)}
              className="accent-[var(--accent)]"
            />
            Свой номер
            <Input
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                if (e.target.value.trim()) onAnswer(e.target.value.trim());
              }}
              placeholder="12А"
              className="h-7 w-20 px-2 text-xs"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

/** «Было → стало» по сцене: текст из файла рядом с нормализованным. Считается в браузере. */
export function SceneDiff({ blocks }: { blocks: NormalizedBlock[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="w-32 px-2 py-1.5">Тип</th>
            <th className="px-2 py-1.5">Было (в файле)</th>
            <th className="px-2 py-1.5">Стало</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => {
            const changed = block.sourceText !== block.text;
            return (
              <tr
                key={block.paragraphIndex}
                className={cn(
                  "border-b border-[var(--border)]/50 align-top",
                  changed && "bg-[var(--accent)]/8",
                )}
              >
                <td className="px-2 py-1 text-[var(--muted-fg)]">
                  {SCRIPT_BLOCK_LABELS[block.type]}
                </td>
                <td className="whitespace-pre-wrap px-2 py-1 text-[var(--muted-fg)]">
                  {block.sourceText}
                </td>
                <td className={cn("whitespace-pre-wrap px-2 py-1", changed && "font-medium")}>
                  {block.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
