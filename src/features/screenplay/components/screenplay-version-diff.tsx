"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  blockDiffLabel,
  diffChangeIndices,
  diffScriptBlocks,
} from "@/features/screenplay/lib/block-diff";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { versionLabel } from "@/features/screenplay/lib/version-label";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type VersionMeta = {
  id: string;
  versionNumber: number;
  title: string | null;
};

type Props = {
  locale: string;
  projectId: string;
  versionA: VersionMeta;
  versionB: VersionMeta;
  blocksA: ScreenplayBlock[];
  blocksB: ScreenplayBlock[];
};

const KIND_STYLES = {
  added: "bg-emerald-500/15 border-emerald-500/30",
  removed: "bg-red-500/15 border-red-500/30 line-through opacity-80",
  modified: "bg-amber-500/15 border-amber-500/30",
  unchanged: "border-transparent opacity-70",
} as const;

export function ScreenplayVersionDiff({
  locale,
  projectId,
  versionA,
  versionB,
  blocksA,
  blocksB,
}: Props) {
  const { items, summary } = useMemo(
    () => diffScriptBlocks(blocksA, blocksB),
    [blocksA, blocksB],
  );
  const changeIndices = useMemo(() => diffChangeIndices(items), [items]);
  const [cursor, setCursor] = useState(0);

  const activeChange = changeIndices[cursor] ?? null;

  useEffect(() => {
    if (activeChange == null) return;
    document
      .getElementById(`diff-${activeChange}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeChange]);

  function go(delta: number) {
    if (changeIndices.length === 0) return;
    setCursor((value) => {
      const next = value + delta;
      if (next < 0) return changeIndices.length - 1;
      if (next >= changeIndices.length) return 0;
      return next;
    });
  }

  const base = `/${locale}/projects/${projectId}/screenplay`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={base}
            className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
          >
            ← Все версии
          </Link>
          <h2 className="font-display text-xl font-semibold">Сравнение версий</h2>
          <p className="text-sm text-[var(--muted-fg)]">
            {versionLabel(versionA)} ↔ {versionLabel(versionB)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={changeIndices.length === 0}
            onClick={() => go(-1)}
          >
            ← Пред. отличие
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={changeIndices.length === 0}
            onClick={() => go(1)}
          >
            След. отличие →
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-[var(--muted-fg)]">Блоков добавлено:</span>{" "}
          {summary.added}
        </div>
        <div>
          <span className="text-[var(--muted-fg)]">Удалено:</span> {summary.removed}
        </div>
        <div>
          <span className="text-[var(--muted-fg)]">Изменено:</span>{" "}
          {summary.modified}
        </div>
        <div>
          <span className="text-[var(--muted-fg)]">Сцен ±:</span> +
          {summary.scenesAdded} / −{summary.scenesRemoved} / ~
          {summary.scenesModified}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium">{versionLabel(versionA)}</h3>
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
            {items.map((item, index) => (
              <div
                key={`a-${index}`}
                id={`diff-${index}`}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  KIND_STYLES[item.kind],
                  activeChange === index && "ring-2 ring-[var(--accent)]",
                )}
              >
                <div className="mb-1 text-[10px] uppercase text-[var(--muted-fg)]">
                  {blockDiffLabel(item.blockA)}
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs">
                  {item.blockA?.content || "—"}
                </pre>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">{versionLabel(versionB)}</h3>
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
            {items.map((item, index) => (
              <div
                key={`b-${index}`}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  KIND_STYLES[item.kind],
                  activeChange === index && "ring-2 ring-[var(--accent)]",
                )}
              >
                <div className="mb-1 text-[10px] uppercase text-[var(--muted-fg)]">
                  {blockDiffLabel(item.blockB)}
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs">
                  {item.blockB?.content || "—"}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--muted-fg)]">
        Легенда:{" "}
        <span className="text-emerald-400">добавлено</span>,{" "}
        <span className="text-red-400">удалено</span>,{" "}
        <span className="text-amber-400">изменено</span>
      </p>
    </div>
  );
}
