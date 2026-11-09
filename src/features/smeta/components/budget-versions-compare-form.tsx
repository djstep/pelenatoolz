"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";

/** Выбор двух версий для сравнения: по умолчанию — предпоследняя и последняя. */
export function BudgetVersionsCompareForm({ versions, compareHref }: { versions: number[]; compareHref: string }) {
  const router = useRouter();
  const [before, setBefore] = useState(String(versions[1] ?? ""));
  const [after, setAfter] = useState(String(versions[0] ?? ""));
  const same = before === after;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Сравнить</span>
      <label className="sr-only" htmlFor="compare-before-trigger">Первая версия</label>
      <div className="w-36">
        <Select id="compare-before" className="h-8" value={before} onChange={(e) => setBefore(e.target.value)}>
          {versions.map((n) => (
            <option key={n} value={String(n)}>
              Версия {n}
            </option>
          ))}
        </Select>
      </div>
      <span>и</span>
      <label className="sr-only" htmlFor="compare-after-trigger">Вторая версия</label>
      <div className="w-36">
        <Select id="compare-after" className="h-8" value={after} onChange={(e) => setAfter(e.target.value)}>
          {versions.map((n) => (
            <option key={n} value={String(n)}>
              Версия {n}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        className="h-8"
        disabled={same}
        onClick={() => router.push(`${compareHref}?a=${encodeURIComponent(before)}&b=${encodeURIComponent(after)}`)}
      >
        Сравнить
      </Button>
      {same ? <span className="text-xs text-[var(--muted-fg)]">выберите две разные версии</span> : null}
    </div>
  );
}
