"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductionWorkExtrasAction } from "@/features/reports/actions";
import {
  reverseFromGross,
  taxAmountFromBase,
  withTax,
} from "@/features/reports/lib/compute-work-pay";
import type { ProductionReportWorkExtra } from "@/features/reports/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

type ExtraDraft = {
  amount: string;
  taxPercent: string;
  taxAmount: string;
  totalWithTax: string;
  description: string;
};

function emptyDraft(): ExtraDraft {
  return {
    amount: "",
    taxPercent: "",
    taxAmount: "",
    totalWithTax: "",
    description: "",
  };
}

export function WorkExtrasModal({
  open,
  onClose,
  displayName,
  workRowId,
  projectId,
  dayId,
  canEdit,
  defaultTaxPercent = 0,
  extras,
}: {
  open: boolean;
  onClose: () => void;
  displayName: string;
  workRowId: string;
  projectId: string;
  dayId: string;
  canEdit: boolean;
  defaultTaxPercent?: number;
  extras: ProductionReportWorkExtra[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [inputMode, setInputMode] = useState<"base" | "gross">("base");
  const [drafts, setDrafts] = useState<ExtraDraft[]>([emptyDraft()]);

  useEffect(() => {
    if (!open) return;
    setDrafts(
      extras.length > 0
        ? extras.map((e) => ({
            amount: String(e.amount),
            taxPercent: e.taxPercent != null ? String(e.taxPercent) : "",
            taxAmount: e.taxAmount != null ? String(e.taxAmount) : "",
            totalWithTax:
              e.totalWithTax != null ? String(e.totalWithTax) : String(e.amount),
            description: e.description ?? "",
          }))
        : [emptyDraft()],
    );
  }, [open, extras]);

  function save() {
    if (!canEdit) return;
    startTransition(async () => {
      const result = await saveProductionWorkExtrasAction(projectId, dayId, {
        workRowId,
        extras: drafts.map((d) => {
          const amount =
            d.amount === "" || d.amount === "-" ? 0 : Number(d.amount);
          const taxPercent =
            d.taxPercent.trim() === ""
              ? defaultTaxPercent
              : Number(d.taxPercent) || 0;
          const taxAmount =
            d.taxAmount.trim() === ""
              ? taxAmountFromBase(amount, taxPercent)
              : Number(d.taxAmount) || 0;
          const totalWithTax =
            d.totalWithTax.trim() === ""
              ? amount + taxAmount
              : Number(d.totalWithTax) || amount + taxAmount;
          return {
            amount,
            taxPercent,
            taxAmount,
            totalWithTax,
            description: d.description,
          };
        }),
      });
      if (result.error) toast.error(result.error);
      else {
        if (result.success) toast.success(result.success);
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Доп. выплаты · ${displayName}`}
      wide
      footer={
        canEdit ? (
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        Разовая сумма (плюс или минус — для штрафов) с комментарием. Можно
        ввести сумму без налога или с налогом.
      </p>
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            checked={inputMode === "base"}
            onChange={() => setInputMode("base")}
          />
          Сумма без налога
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            checked={inputMode === "gross"}
            onChange={() => setInputMode("gross")}
          />
          Сумма с налогом
        </label>
      </div>
      <div className="space-y-3">
        {drafts.map((d, i) => {
          const base = Number(d.amount) || 0;
          const taxPct =
            d.taxPercent.trim() === ""
              ? defaultTaxPercent
              : Number(d.taxPercent) || 0;
          const computedTax = taxAmountFromBase(base, taxPct);
          const computedTotal = withTax(base, taxPct);
          const grossMode = inputMode === "gross";
          return (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[110px_90px_100px_110px_1fr_auto]"
            >
              <Input
                type="number"
                step="0.01"
                disabled={!canEdit || pending || grossMode}
                className={cn(grossMode && "opacity-70")}
                placeholder="Сумма"
                value={d.amount}
                onChange={(e) => {
                  const amount = e.target.value;
                  const nextBase = Number(amount) || 0;
                  setDrafts((prev) =>
                    prev.map((row, idx) =>
                      idx === i
                        ? {
                            ...row,
                            amount,
                            taxAmount: taxAmountFromBase(
                              nextBase,
                              taxPct,
                            ).toFixed(2),
                            totalWithTax: withTax(nextBase, taxPct).toFixed(2),
                          }
                        : row,
                    ),
                  );
                }}
              />
              <Input
                type="number"
                step="0.01"
                disabled={!canEdit || pending || grossMode}
                className={cn(grossMode && "opacity-70")}
                placeholder={String(defaultTaxPercent || "налог %")}
                value={d.taxPercent}
                onChange={(e) => {
                  const taxPercent = e.target.value;
                  const pct =
                    taxPercent.trim() === ""
                      ? defaultTaxPercent
                      : Number(taxPercent) || 0;
                  setDrafts((prev) =>
                    prev.map((row, idx) =>
                      idx === i
                        ? {
                            ...row,
                            taxPercent,
                            taxAmount: taxAmountFromBase(base, pct).toFixed(2),
                            totalWithTax: withTax(base, pct).toFixed(2),
                          }
                        : row,
                    ),
                  );
                }}
              />
              <Input
                type="number"
                step="0.01"
                disabled={!canEdit || pending || !grossMode}
                className={cn(!grossMode && "opacity-70")}
                placeholder="Налог"
                value={grossMode ? d.taxAmount : computedTax.toFixed(2)}
                onChange={(e) => {
                  const taxAmount = e.target.value;
                  const gross = Number(d.totalWithTax) || 0;
                  const rev = reverseFromGross({
                    amountWithTax: gross,
                    taxAmount: Number(taxAmount) || 0,
                  });
                  setDrafts((prev) =>
                    prev.map((row, idx) =>
                      idx === i
                        ? {
                            ...row,
                            taxAmount,
                            amount: rev.base.toFixed(2),
                            taxPercent: rev.taxPercent.toFixed(4),
                          }
                        : row,
                    ),
                  );
                }}
              />
              <Input
                type="number"
                step="0.01"
                disabled={!canEdit || pending || !grossMode}
                className={cn(!grossMode && "opacity-70")}
                placeholder="С налогом"
                value={grossMode ? d.totalWithTax : computedTotal.toFixed(2)}
                onChange={(e) => {
                  const totalWithTax = e.target.value;
                  const rev = reverseFromGross({
                    amountWithTax: Number(totalWithTax) || 0,
                    taxAmount: Number(d.taxAmount) || 0,
                  });
                  setDrafts((prev) =>
                    prev.map((row, idx) =>
                      idx === i
                        ? {
                            ...row,
                            totalWithTax,
                            amount: rev.base.toFixed(2),
                            taxPercent: rev.taxPercent.toFixed(4),
                          }
                        : row,
                    ),
                  );
                }}
              />
              <Input
                disabled={!canEdit || pending}
                placeholder="Комментарий"
                value={d.description}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((row, idx) =>
                      idx === i
                        ? { ...row, description: e.target.value }
                        : row,
                    ),
                  )
                }
              />
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending || drafts.length <= 1}
                  onClick={() =>
                    setDrafts((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  ✕
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {canEdit ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          disabled={pending}
          onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
        >
          + Добавить выплату
        </Button>
      ) : null}
    </Modal>
  );
}
