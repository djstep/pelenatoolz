"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  blockDiffLabel,
  diffChangeIndices,
  diffScriptBlocks,
  type BlockDiffItem,
  type BlockDiffKind,
} from "@/features/screenplay/lib/block-diff";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { versionLabel } from "@/features/screenplay/lib/version-label";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

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

/** В diff(old, new): side "a" = старая, side "b" = новая. */
type DiffSide = "a" | "b";

function sideCellClass(kind: BlockDiffKind, side: DiffSide): string {
  switch (kind) {
    case "unchanged":
      return "border-transparent opacity-70";
    case "modified":
      return "bg-amber-500/15 border-amber-500/30";
    case "removed":
      // Блок был в старой (a) и удалён в новой (b)
      return side === "a"
        ? "bg-red-500/15 border-red-500/30"
        : "bg-red-500/15 border-red-500/30 line-through opacity-80";
    case "added":
      // Блок появился в новой (b), в старой (a) его не было
      return side === "b"
        ? "bg-emerald-500/15 border-emerald-500/30"
        : "bg-emerald-500/15 border-emerald-500/30 line-through opacity-80";
    default:
      return "border-transparent";
  }
}

function sideBlock(item: BlockDiffItem, side: DiffSide): ScreenplayBlock | null {
  if (side === "a") {
    // Старая колонка: свой текст, либо «призрак» добавленного из новой
    return item.blockA ?? (item.kind === "added" ? item.blockB : null);
  }
  // Новая колонка: свой текст, либо «призрак» удалённого из старой
  return item.blockB ?? (item.kind === "removed" ? item.blockA : null);
}

function DiffBlockCard({
  item,
  side,
  active,
  id,
}: {
  item: BlockDiffItem;
  side: DiffSide;
  active: boolean;
  id?: string;
}) {
  const block = sideBlock(item, side);
  const ownsContent =
    (side === "a" && item.blockA != null) ||
    (side === "b" && item.blockB != null);
  const isGhost = !ownsContent && block != null;

  return (
    <div
      id={id}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        sideCellClass(item.kind, side),
        active && "ring-2 ring-[var(--accent)]",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase text-[var(--muted-fg)]">
        <span>{blockDiffLabel(block)}</span>
        {isGhost ? (
          <span className="normal-case tracking-normal opacity-80">
            {item.kind === "removed" ? "удалено здесь" : "добавлено в другой"}
          </span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap font-mono text-xs">
        {block?.content?.trim() ? block.content : "—"}
      </pre>
    </div>
  );
}

export function ScreenplayVersionDiff({
  locale,
  projectId,
  versionA,
  versionB,
  blocksA,
  blocksB,
}: Props) {
  // Слева — более новая версия, справа — более ранняя (как «после правок» / «до»).
  const aIsNewer =
    versionA.versionNumber > versionB.versionNumber ||
    (versionA.versionNumber === versionB.versionNumber &&
      versionA.id >= versionB.id);

  const newerMeta = aIsNewer ? versionA : versionB;
  const olderMeta = aIsNewer ? versionB : versionA;
  const newerBlocks = aIsNewer ? blocksA : blocksB;
  const olderBlocks = aIsNewer ? blocksB : blocksA;

  // diff(старая, новая): removed = удалили в новой, added = появилось в новой
  const { items, summary } = useMemo(
    () => diffScriptBlocks(olderBlocks, newerBlocks),
    [olderBlocks, newerBlocks],
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
            {versionLabel(newerMeta)}{" "}
            <span className="text-[var(--muted-fg)]/70">(новее)</span>
            {" ↔ "}
            {versionLabel(olderMeta)}{" "}
            <span className="text-[var(--muted-fg)]/70">(раньше)</span>
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
          <span className="text-[var(--muted-fg)]">Удалено:</span>{" "}
          {summary.removed}
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
          <h3 className="mb-2 text-sm font-medium">
            {versionLabel(newerMeta)}
            <span className="ml-2 text-xs font-normal text-[var(--muted-fg)]">
              новее
            </span>
          </h3>
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
            {items.map((item, index) => (
              <DiffBlockCard
                key={`newer-${index}`}
                id={`diff-${index}`}
                item={item}
                side="b"
                active={activeChange === index}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">
            {versionLabel(olderMeta)}
            <span className="ml-2 text-xs font-normal text-[var(--muted-fg)]">
              раньше
            </span>
          </h3>
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
            {items.map((item, index) => (
              <DiffBlockCard
                key={`older-${index}`}
                item={item}
                side="a"
                active={activeChange === index}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--muted-fg)]">
        Легенда:{" "}
        <span className="text-red-400">удалено</span> — в старой версии текст
        выделен, в новой тот же текст зачёркнут;{" "}
        <span className="text-emerald-400">добавлено</span> — в новой заливка, в
        старой зачёркнутый «призрак»;{" "}
        <span className="text-amber-400">изменено</span> — свой текст с каждой
        стороны.
      </p>
    </div>
  );
}
