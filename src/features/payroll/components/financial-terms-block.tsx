"use client";

import { useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  OVERTIME_MODE_LABELS,
  UNPAID_OT_MODE_LABELS,
  reverseFromGross,
  taxAmountFromBase,
  withTax,
  type OvertimeCalcMode,
  type UnpaidOvertimeMode,
} from "@/features/reports/lib/compute-work-pay";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

export type OvertimeSeed = {
  hourNumber: number;
  percentRate: number | null;
  amount: number | null;
  taxPercent: number | null;
};

export type ExtraSeed = {
  paymentDate: string;
  amount: string;
  taxPercent: string;
  taxAmount?: string;
  totalWithTax?: string;
  description: string;
};

type OvertimeRowState = {
  hourNumber: number;
  pct: string;
  amount: string;
  taxPercent: string;
  /** percent = amount locked; amount = pct optional cleared */
  entryMode: "percent" | "amount" | "empty";
};

function toNum(v: { toString(): string } | number | null | undefined) {
  if (v == null) return null;
  return Number(v);
}

function PayrollTableInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "glass-input w-full min-w-[4.5rem] rounded-lg px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]",
        className,
      )}
    />
  );
}

function initOvertimeRows(seeds: OvertimeSeed[]): OvertimeRowState[] {
  const maxHour = Math.max(4, ...seeds.map((s) => s.hourNumber), 0);
  return Array.from({ length: maxHour }, (_, idx) => {
    const hour = idx + 1;
    const seed = seeds.find((s) => s.hourNumber === hour);
    const hasPct = seed?.percentRate != null;
    const hasAmount = seed?.amount != null && !hasPct;
    return {
      hourNumber: hour,
      pct: seed?.percentRate != null ? String(seed.percentRate) : "",
      amount: seed?.amount != null ? String(seed.amount) : "",
      taxPercent: seed?.taxPercent != null ? String(seed.taxPercent) : "",
      entryMode: hasPct ? "percent" : hasAmount ? "amount" : "empty",
    };
  });
}

function isOvertimeRowFilled(row: OvertimeRowState) {
  return row.pct.trim() !== "" || row.amount.trim() !== "";
}

function computeOvertimeRow(
  row: OvertimeRowState,
  shiftRate: number,
  globalTaxPercent: number,
) {
  if (!isOvertimeRowFilled(row)) return null;

  const pct = row.pct.trim() === "" ? null : Number(row.pct);
  let amount = row.amount.trim() === "" ? null : Number(row.amount);
  if (
    row.entryMode === "percent" &&
    pct != null &&
    !Number.isNaN(pct) &&
    shiftRate > 0
  ) {
    amount = (shiftRate * pct) / 100;
  }
  if (amount == null || Number.isNaN(amount)) return null;

  const rowTax =
    row.taxPercent.trim() === ""
      ? globalTaxPercent
      : Number(row.taxPercent) || 0;
  const taxAmount = taxAmountFromBase(amount, rowTax);
  return { amount, taxAmount, total: amount + taxAmount };
}

function isExtraRowFilled(row: ExtraSeed) {
  return (
    row.amount.trim() !== "" ||
    row.paymentDate.trim() !== "" ||
    row.description.trim() !== "" ||
    (row.totalWithTax ?? "").trim() !== ""
  );
}

function computeExtraRow(row: ExtraSeed, globalTaxPercent: number) {
  if (!isExtraRowFilled(row)) return null;
  const amount = row.amount.trim() === "" ? 0 : Number(row.amount);
  if (Number.isNaN(amount)) return null;
  const rowTax =
    row.taxPercent.trim() === ""
      ? globalTaxPercent
      : Number(row.taxPercent) || 0;
  return withTax(amount, rowTax);
}

function hourLabel(mode: OvertimeCalcMode, hour: number) {
  if (mode === "HALF_HOUR") return "Интервал 30 мин";
  if (mode === "HOURLY_FLAT") {
    return hour === 1 ? "За 1 час целиком" : `За ${hour} часа целиком`;
  }
  return `${hour}-й час`;
}

export function FinancialTermsBlock({
  title = "Финансовые условия",
  shiftRate = 0,
  taxPercent = 0,
  shiftHoursMin,
  unpaidOvertimeMin,
  pickupOffsetMin,
  overtimeMode = "HOURLY_CUMULATIVE",
  unpaidOvertimeMode = "FIRST_HOUR",
  overtime = [],
  extras,
  showExtras = true,
  showPickupOffset = false,
  showKmRate = false,
  kmRate = null,
  footer,
}: {
  title?: string;
  shiftRate?: number;
  taxPercent?: number;
  shiftHoursMin?: number | null;
  unpaidOvertimeMin?: number | null;
  pickupOffsetMin?: number | null;
  overtimeMode?: OvertimeCalcMode | null;
  unpaidOvertimeMode?: UnpaidOvertimeMode | null;
  overtime?: OvertimeSeed[];
  extras?: ExtraSeed[];
  showExtras?: boolean;
  showPickupOffset?: boolean;
  showKmRate?: boolean;
  kmRate?: number | null;
  footer?: ReactNode;
}) {
  const [otMode, setOtMode] = useState<OvertimeCalcMode>(
    overtimeMode ?? "HOURLY_CUMULATIVE",
  );
  const [unpaidMode, setUnpaidMode] = useState<UnpaidOvertimeMode>(
    unpaidOvertimeMode ?? "FIRST_HOUR",
  );
  const [otRows, setOtRows] = useState(() => initOvertimeRows(overtime));
  const [epRows, setEpRows] = useState<ExtraSeed[]>(
    extras?.length
      ? extras
      : [{ paymentDate: "", amount: "", taxPercent: "", description: "" }],
  );
  const [extrasInputMode, setExtrasInputMode] = useState<"base" | "gross">(
    "base",
  );
  const [taxPct, setTaxPct] = useState(taxPercent);
  const [rate, setRate] = useState(shiftRate);
  const [taxAmountInput, setTaxAmountInput] = useState(() =>
    shiftRate > 0 ? taxAmountFromBase(shiftRate, taxPercent).toFixed(2) : "",
  );
  const [grossInput, setGrossInput] = useState(() =>
    shiftRate > 0 ? withTax(shiftRate, taxPercent).toFixed(2) : "",
  );
  const [shiftInputMode, setShiftInputMode] = useState<"base" | "gross">("base");
  const [shiftHours, setShiftHours] = useState(
    () => formatMinutesHhMm(shiftHoursMin) || "12:00",
  );
  const [unpaidOvertime, setUnpaidOvertime] = useState(
    () => formatMinutesHhMm(unpaidOvertimeMin) || "",
  );
  const [pickupOffset, setPickupOffset] = useState(
    () => formatMinutesHhMm(pickupOffsetMin) || "",
  );
  const [kmRateValue, setKmRateValue] = useState(
    () => (kmRate != null && kmRate > 0 ? String(kmRate) : ""),
  );

  const amountWithTax = useMemo(
    () => withTax(rate, taxPct),
    [rate, taxPct],
  );
  const taxAmount = useMemo(
    () => taxAmountFromBase(rate, taxPct),
    [rate, taxPct],
  );

  const visibleOtRows =
    otMode === "HALF_HOUR"
      ? otRows.slice(0, 1).map((r) => ({ ...r, hourNumber: 1 }))
      : otRows;

  function syncFromBase(nextRate: number, nextTaxPct: number) {
    setRate(nextRate);
    setTaxPct(nextTaxPct);
    setTaxAmountInput(
      nextRate > 0 ? taxAmountFromBase(nextRate, nextTaxPct).toFixed(2) : "",
    );
    setGrossInput(
      nextRate > 0 ? withTax(nextRate, nextTaxPct).toFixed(2) : "",
    );
  }

  function applyGrossInputs(grossStr: string, taxStr: string) {
    const gross = Number(grossStr);
    const taxAmt = Number(taxStr);
    if (!Number.isFinite(gross) || !Number.isFinite(taxAmt)) return;
    const rev = reverseFromGross({ amountWithTax: gross, taxAmount: taxAmt });
    setRate(Number(rev.base.toFixed(2)));
    setTaxPct(Number(rev.taxPercent.toFixed(4)));
    setGrossInput(grossStr);
    setTaxAmountInput(taxStr);
  }

  const updateOtRow = (hour: number, patch: Partial<OvertimeRowState>) => {
    setOtRows((prev) => {
      const ensured =
        prev.some((r) => r.hourNumber === hour)
          ? prev
          : [
              ...prev,
              {
                hourNumber: hour,
                pct: "",
                amount: "",
                taxPercent: "",
                entryMode: "empty" as const,
              },
            ];
      return ensured.map((row) =>
        row.hourNumber === hour ? { ...row, ...patch } : row,
      );
    });
  };

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      <h4 className="font-semibold">{title}</h4>

      <div className="flex flex-wrap gap-3 text-xs">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="shiftInputMode"
            checked={shiftInputMode === "base"}
            onChange={() => setShiftInputMode("base")}
          />
          Ввод без налога
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="shiftInputMode"
            checked={shiftInputMode === "gross"}
            onChange={() => setShiftInputMode("gross")}
          />
          Ввод суммы с налогом (обратный расчёт)
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="shiftRate">Стоимость смены</Label>
          <Input
            id="shiftRate"
            name="shiftRate"
            type="number"
            min={0}
            step="0.01"
            value={rate || ""}
            readOnly={shiftInputMode === "gross"}
            className={shiftInputMode === "gross" ? "opacity-70" : undefined}
            onChange={(e) => {
              const next = Number(e.target.value) || 0;
              syncFromBase(next, taxPct);
            }}
          />
        </div>
        <div>
          <Label htmlFor="taxPercent">Налог %</Label>
          <Input
            id="taxPercent"
            name="taxPercent"
            type="number"
            step="0.01"
            value={taxPct || ""}
            readOnly={shiftInputMode === "gross"}
            className={shiftInputMode === "gross" ? "opacity-70" : undefined}
            onChange={(e) => {
              const next = Number(e.target.value) || 0;
              syncFromBase(rate, next);
            }}
          />
        </div>
        <div>
          <Label htmlFor="taxAmountDisplay">Сумма налога</Label>
          <Input
            id="taxAmountDisplay"
            type="number"
            step="0.01"
            value={
              shiftInputMode === "gross" ? taxAmountInput : taxAmount.toFixed(2)
            }
            readOnly={shiftInputMode === "base"}
            className={shiftInputMode === "base" ? "opacity-70" : undefined}
            onChange={(e) => {
              const nextTax = e.target.value;
              setTaxAmountInput(nextTax);
              applyGrossInputs(grossInput || "0", nextTax);
            }}
          />
        </div>
        <div>
          <Label htmlFor="amountWithTax">Сумма с налогом</Label>
          <Input
            id="amountWithTax"
            type="number"
            step="0.01"
            value={
              shiftInputMode === "gross"
                ? grossInput
                : amountWithTax.toFixed(2)
            }
            readOnly={shiftInputMode === "base"}
            className={shiftInputMode === "base" ? "opacity-70" : undefined}
            onChange={(e) => {
              const nextGross = e.target.value;
              setGrossInput(nextGross);
              applyGrossInputs(nextGross, taxAmountInput || "0");
            }}
          />
        </div>
        <div>
          <Label htmlFor="shiftHoursMin">Продолжительность смены</Label>
          <input type="hidden" name="shiftHoursMin" value={shiftHours} />
          <HhMmInput
            id="shiftHoursMin"
            mode="duration"
            value={shiftHours}
            onChange={setShiftHours}
            placeholder="12:00"
          />
        </div>
        <div>
          <Label htmlFor="unpaidOvertimeMin">Неоплачиваемая переработка</Label>
          <input type="hidden" name="unpaidOvertimeMin" value={unpaidOvertime} />
          <HhMmInput
            id="unpaidOvertimeMin"
            mode="duration"
            value={unpaidOvertime}
            onChange={setUnpaidOvertime}
            placeholder="00:30"
          />
        </div>
        <div>
          <Label htmlFor="unpaidOvertimeMode">Учёт неоплач. переработки</Label>
          <Select
            id="unpaidOvertimeMode"
            name="unpaidOvertimeMode"
            value={unpaidMode}
            onChange={(e) =>
              setUnpaidMode(e.target.value as UnpaidOvertimeMode)
            }
          >
            {(Object.keys(UNPAID_OT_MODE_LABELS) as UnpaidOvertimeMode[]).map(
              (k) => (
                <option key={k} value={k}>
                  {UNPAID_OT_MODE_LABELS[k]}
                </option>
              ),
            )}
          </Select>
        </div>
        {showPickupOffset ? (
          <div>
            <Label htmlFor="pickupOffsetMin">Подача до готовности</Label>
            <input type="hidden" name="pickupOffsetMin" value={pickupOffset} />
            <HhMmInput
              id="pickupOffsetMin"
              mode="duration"
              value={pickupOffset}
              onChange={setPickupOffset}
              placeholder="01:00"
            />
          </div>
        ) : null}
        {showKmRate ? (
          <div>
            <Label htmlFor="kmRate">Ставка за км</Label>
            <Input
              id="kmRate"
              name="kmRate"
              type="number"
              min={0}
              step="0.01"
              value={kmRateValue}
              onChange={(e) => setKmRateValue(e.target.value)}
              placeholder="0"
            />
            <p className="mt-1 text-[10px] text-[var(--muted-fg)]">
              Для игрового и спецтранспорта: стоимость = ставка × факт. км
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <h5 className="text-sm font-semibold">Стоимость переработки</h5>
          <div className="min-w-[16rem]">
            <Label htmlFor="overtimeMode">Режим расчёта</Label>
            <Select
              id="overtimeMode"
              name="overtimeMode"
              value={otMode}
              onChange={(e) => {
                const next = e.target.value as OvertimeCalcMode;
                setOtMode(next);
                if (next === "HALF_HOUR" && otRows.length === 0) {
                  setOtRows([
                    {
                      hourNumber: 1,
                      pct: "",
                      amount: "",
                      taxPercent: "",
                      entryMode: "empty",
                    },
                  ]);
                }
              }}
            >
              {(Object.keys(OVERTIME_MODE_LABELS) as OvertimeCalcMode[]).map(
                (k) => (
                  <option key={k} value={k}>
                    {OVERTIME_MODE_LABELS[k]}
                  </option>
                ),
              )}
            </Select>
          </div>
        </div>
        <p className="mb-2 text-xs text-[var(--muted-fg)]">
          Задайте либо % от стоимости смены (сумма блокируется), либо фиксированную
          сумму.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--muted-fg)]">
                <th className="py-1 pr-2">
                  {otMode === "HALF_HOUR" ? "Интервал" : "Час"}
                </th>
                <th className="py-1 pr-2">%</th>
                <th className="py-1 pr-2">Сумма</th>
                <th className="py-1 pr-2">Налог %</th>
                <th className="py-1 pr-2">Налог</th>
                <th className="py-1 pr-2">Сумма с налогом</th>
              </tr>
            </thead>
            <tbody>
              {visibleOtRows.map((row) => {
                const computed = computeOvertimeRow(row, rate, taxPct);
                const percentLocked = row.entryMode === "percent";
                return (
                  <tr key={row.hourNumber}>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {hourLabel(otMode, row.hourNumber)}
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={`ot_pct_${row.hourNumber}`}
                        inputMode="decimal"
                        placeholder="—"
                        value={row.pct}
                        onChange={(e) => {
                          const pct = e.target.value;
                          updateOtRow(row.hourNumber, {
                            pct,
                            entryMode: pct.trim() ? "percent" : "empty",
                            amount: "",
                          });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={
                          percentLocked
                            ? undefined
                            : `ot_amount_${row.hourNumber}`
                        }
                        inputMode="decimal"
                        placeholder="—"
                        value={
                          percentLocked
                            ? computed
                              ? computed.amount.toFixed(2)
                              : ""
                            : row.amount
                        }
                        readOnly={percentLocked}
                        className={percentLocked ? "opacity-70" : undefined}
                        onChange={(e) =>
                          updateOtRow(row.hourNumber, {
                            amount: e.target.value,
                            pct: "",
                            entryMode: e.target.value.trim()
                              ? "amount"
                              : "empty",
                          })
                        }
                      />
                      {percentLocked && computed ? (
                        <input
                          type="hidden"
                          name={`ot_amount_${row.hourNumber}`}
                          value={computed.amount.toFixed(2)}
                        />
                      ) : null}
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={`ot_tax_${row.hourNumber}`}
                        inputMode="decimal"
                        placeholder={taxPct ? String(taxPct) : "—"}
                        value={row.taxPercent}
                        readOnly={percentLocked}
                        className={percentLocked ? "opacity-70" : undefined}
                        onChange={(e) =>
                          updateOtRow(row.hourNumber, {
                            taxPercent: e.target.value,
                          })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2 text-[var(--muted-fg)]">
                      {computed ? computed.taxAmount.toFixed(2) : "—"}
                    </td>
                    <td className="py-1 pr-2 text-[var(--muted-fg)]">
                      {computed ? computed.total.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {otMode !== "HALF_HOUR" ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() =>
              setOtRows((prev) => [
                ...prev,
                {
                  hourNumber: prev.length + 1,
                  pct: "",
                  amount: "",
                  taxPercent: "",
                  entryMode: "empty",
                },
              ])
            }
          >
            + Добавить час
          </Button>
        ) : null}
      </div>

      {showExtras ? (
        <div>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <h5 className="text-sm font-semibold">Дополнительные выплаты</h5>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="extrasInputMode"
                  checked={extrasInputMode === "base"}
                  onChange={() => setExtrasInputMode("base")}
                />
                Сумма без налога
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="extrasInputMode"
                  checked={extrasInputMode === "gross"}
                  onChange={() => setExtrasInputMode("gross")}
                />
                Сумма с налогом
              </label>
            </div>
          </div>
          <p className="mb-2 text-xs text-[var(--muted-fg)]">
            Разовая сумма на любую дату (плюс или минус — для штрафов) с
            комментарием.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[var(--muted-fg)]">
                  <th className="py-1 pr-2">Дата</th>
                  <th className="py-1 pr-2">Сумма</th>
                  <th className="py-1 pr-2">Налог %</th>
                  <th className="py-1 pr-2">Налог</th>
                  <th className="py-1 pr-2">Сумма с налогом</th>
                  <th className="py-1 pr-2">Описание</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {epRows.map((row, i) => {
                  const total = computeExtraRow(row, taxPct);
                  const taxAmt =
                    total != null
                      ? total - (row.amount.trim() === "" ? 0 : Number(row.amount) || 0)
                      : null;
                  const grossMode = extrasInputMode === "gross";
                  return (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <Input
                          name={`ep_date_${i}`}
                          type="date"
                          value={row.paymentDate}
                          onChange={(e) =>
                            setEpRows((prev) =>
                              prev.map((r, idx) =>
                                idx === i
                                  ? { ...r, paymentDate: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <PayrollTableInput
                          name={`ep_amount_${i}`}
                          inputMode="decimal"
                          placeholder="—"
                          value={row.amount}
                          readOnly={grossMode}
                          className={grossMode ? "opacity-70" : undefined}
                          onChange={(e) =>
                            setEpRows((prev) =>
                              prev.map((r, idx) => {
                                if (idx !== i) return r;
                                const nextAmount = e.target.value;
                                const nextTaxPct =
                                  r.taxPercent.trim() === ""
                                    ? taxPct
                                    : Number(r.taxPercent) || 0;
                                const base = Number(nextAmount) || 0;
                                return {
                                  ...r,
                                  amount: nextAmount,
                                  taxAmount: taxAmountFromBase(
                                    base,
                                    nextTaxPct,
                                  ).toFixed(2),
                                  totalWithTax: withTax(
                                    base,
                                    nextTaxPct,
                                  ).toFixed(2),
                                };
                              }),
                            )
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <PayrollTableInput
                          name={`ep_tax_${i}`}
                          inputMode="decimal"
                          placeholder={taxPct ? String(taxPct) : "—"}
                          value={row.taxPercent}
                          readOnly={grossMode}
                          className={grossMode ? "opacity-70" : undefined}
                          onChange={(e) =>
                            setEpRows((prev) =>
                              prev.map((r, idx) => {
                                if (idx !== i) return r;
                                const nextTaxPct = e.target.value;
                                const pct =
                                  nextTaxPct.trim() === ""
                                    ? taxPct
                                    : Number(nextTaxPct) || 0;
                                const base = Number(r.amount) || 0;
                                return {
                                  ...r,
                                  taxPercent: nextTaxPct,
                                  taxAmount: taxAmountFromBase(
                                    base,
                                    pct,
                                  ).toFixed(2),
                                  totalWithTax: withTax(base, pct).toFixed(2),
                                };
                              }),
                            )
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        {grossMode ? (
                          <PayrollTableInput
                            name={`ep_tax_amount_${i}`}
                            inputMode="decimal"
                            placeholder="—"
                            value={row.taxAmount ?? ""}
                            onChange={(e) => {
                              const nextTaxAmt = e.target.value;
                              setEpRows((prev) =>
                                prev.map((r, idx) => {
                                  if (idx !== i) return r;
                                  const gross = Number(r.totalWithTax) || 0;
                                  const taxAmt = Number(nextTaxAmt) || 0;
                                  const rev = reverseFromGross({
                                    amountWithTax: gross,
                                    taxAmount: taxAmt,
                                  });
                                  return {
                                    ...r,
                                    taxAmount: nextTaxAmt,
                                    amount: rev.base.toFixed(2),
                                    taxPercent: rev.taxPercent.toFixed(4),
                                  };
                                }),
                              );
                            }}
                          />
                        ) : (
                          <span className="text-[var(--muted-fg)]">
                            {taxAmt != null && !Number.isNaN(taxAmt)
                              ? taxAmt.toFixed(2)
                              : "—"}
                            {total != null ? (
                              <input
                                type="hidden"
                                name={`ep_tax_amount_${i}`}
                                value={taxAmt?.toFixed(2) ?? "0"}
                              />
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        {grossMode ? (
                          <PayrollTableInput
                            name={`ep_total_${i}`}
                            inputMode="decimal"
                            placeholder="—"
                            value={row.totalWithTax ?? ""}
                            onChange={(e) => {
                              const nextGross = e.target.value;
                              setEpRows((prev) =>
                                prev.map((r, idx) => {
                                  if (idx !== i) return r;
                                  const gross = Number(nextGross) || 0;
                                  const taxAmt = Number(r.taxAmount) || 0;
                                  const rev = reverseFromGross({
                                    amountWithTax: gross,
                                    taxAmount: taxAmt,
                                  });
                                  return {
                                    ...r,
                                    totalWithTax: nextGross,
                                    amount: rev.base.toFixed(2),
                                    taxPercent: rev.taxPercent.toFixed(4),
                                  };
                                }),
                              );
                            }}
                          />
                        ) : (
                          <span className="text-[var(--muted-fg)]">
                            {total != null ? total.toFixed(2) : "—"}
                            {total != null ? (
                              <input
                                type="hidden"
                                name={`ep_total_${i}`}
                                value={total.toFixed(2)}
                              />
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <PayrollTableInput
                          name={`ep_desc_${i}`}
                          placeholder="—"
                          value={row.description}
                          onChange={(e) =>
                            setEpRows((prev) =>
                              prev.map((r, idx) =>
                                idx === i
                                  ? { ...r, description: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2"
                          onClick={() =>
                            setEpRows((prev) =>
                              prev.length <= 1
                                ? prev
                                : prev.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() =>
              setEpRows((prev) => [
                ...prev,
                {
                  paymentDate: "",
                  amount: "",
                  taxPercent: "",
                  taxAmount: "",
                  totalWithTax: "",
                  description: "",
                },
              ])
            }
          >
            + Добавить
          </Button>
        </div>
      ) : null}

      {footer}
    </div>
  );
}

export function seedOvertime(
  rates: Array<{
    hourNumber: number;
    percentRate: { toString(): string } | null;
    amount: { toString(): string } | null;
    taxPercent: { toString(): string } | null;
  }>,
): OvertimeSeed[] {
  return rates.map((r) => ({
    hourNumber: r.hourNumber,
    percentRate: toNum(r.percentRate),
    amount: toNum(r.amount),
    taxPercent: toNum(r.taxPercent),
  }));
}

export function seedExtras(
  payments: Array<{
    paymentDate: Date | null;
    amount: { toString(): string };
    taxPercent: { toString(): string } | null;
    taxAmount?: { toString(): string } | null;
    totalWithTax?: { toString(): string } | null;
    description: string | null;
  }>,
): ExtraSeed[] {
  return payments.map((p) => ({
    paymentDate: p.paymentDate
      ? new Date(p.paymentDate).toISOString().slice(0, 10)
      : "",
    amount: String(p.amount),
    taxPercent: p.taxPercent != null ? String(p.taxPercent) : "",
    taxAmount: p.taxAmount != null ? String(p.taxAmount) : "",
    totalWithTax: p.totalWithTax != null ? String(p.totalWithTax) : "",
    description: p.description ?? "",
  }));
}
