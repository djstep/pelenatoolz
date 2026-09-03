"use client";

import { useMemo, useState, type InputHTMLAttributes } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { cn } from "@/shared/lib/cn";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { HhMmInput } from "@/shared/ui/hh-mm-input";

type OvertimeSeed = {
  hourNumber: number;
  percentRate: number | null;
  amount: number | null;
  forceMajeurePct: number | null;
};

type OvertimeRowState = {
  hourNumber: number;
  pct: string;
  amount: string;
  fkPct: string;
};

type ExtraSeed = {
  paymentDate: string;
  amount: string;
  forceMajeurePct: string;
  description: string;
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
    return {
      hourNumber: hour,
      pct: seed?.percentRate != null ? String(seed.percentRate) : "",
      amount: seed?.amount != null ? String(seed.amount) : "",
      fkPct:
        seed?.forceMajeurePct != null ? String(seed.forceMajeurePct) : "",
    };
  });
}

function isOvertimeRowFilled(row: OvertimeRowState) {
  return row.pct.trim() !== "" || row.amount.trim() !== "";
}

function computeOvertimeRow(
  row: OvertimeRowState,
  shiftRate: number,
  globalFkPct: number,
) {
  if (!isOvertimeRowFilled(row)) return null;

  const pct = row.pct.trim() === "" ? null : Number(row.pct);
  let amount = row.amount.trim() === "" ? null : Number(row.amount);
  if ((amount == null || Number.isNaN(amount)) && pct != null && !Number.isNaN(pct) && shiftRate > 0) {
    amount = (shiftRate * pct) / 100;
  }
  if (amount == null || Number.isNaN(amount)) return null;

  const rowFk =
    row.fkPct.trim() === "" ? globalFkPct : Number(row.fkPct) || 0;
  const fkAmt = (amount * rowFk) / 100;
  return { amount, fkAmt, total: amount + fkAmt };
}

function isExtraRowFilled(row: ExtraSeed) {
  return (
    row.amount.trim() !== "" ||
    row.paymentDate.trim() !== "" ||
    row.description.trim() !== ""
  );
}

function computeExtraRow(row: ExtraSeed, globalFkPct: number) {
  if (!isExtraRowFilled(row)) return null;
  const amount = row.amount.trim() === "" ? 0 : Number(row.amount);
  if (Number.isNaN(amount)) return null;
  const rowFk =
    row.forceMajeurePct.trim() === ""
      ? globalFkPct
      : Number(row.forceMajeurePct) || 0;
  const total = amount + (amount * rowFk) / 100;
  return total;
}

export function ActorPayrollBlock({
  shiftRate = 0,
  forceMajeurePct = 0,
  shiftHoursMin,
  unpaidOvertimeMin,
  pickupOffsetMin,
  overtime = [],
  extras = [],
}: {
  shiftRate?: number;
  forceMajeurePct?: number;
  shiftHoursMin?: number | null;
  unpaidOvertimeMin?: number | null;
  pickupOffsetMin?: number | null;
  overtime?: OvertimeSeed[];
  extras?: ExtraSeed[];
}) {
  const [otRows, setOtRows] = useState(() => initOvertimeRows(overtime));
  const [epRows, setEpRows] = useState<ExtraSeed[]>(
    extras.length
      ? extras
      : [{ paymentDate: "", amount: "", forceMajeurePct: "", description: "" }],
  );
  const [fkPct, setFkPct] = useState(forceMajeurePct);
  const [rate, setRate] = useState(shiftRate);
  const [shiftHours, setShiftHours] = useState(
    () => formatMinutesHhMm(shiftHoursMin) || "",
  );
  const [unpaidOvertime, setUnpaidOvertime] = useState(
    () => formatMinutesHhMm(unpaidOvertimeMin) || "",
  );
  const [pickupOffset, setPickupOffset] = useState(
    () => formatMinutesHhMm(pickupOffsetMin) || "",
  );

  const amountWithFk = useMemo(
    () => rate + (rate * fkPct) / 100,
    [rate, fkPct],
  );

  const updateOtRow = (hour: number, patch: Partial<OvertimeRowState>) => {
    setOtRows((prev) =>
      prev.map((row) => (row.hourNumber === hour ? { ...row, ...patch } : row)),
    );
  };

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      <h4 className="font-semibold">Гонорар (зарплатная ведомость)</h4>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="shiftRate">Стоимость за смену</Label>
          <Input
            id="shiftRate"
            name="shiftRate"
            type="number"
            min={0}
            value={rate || ""}
            onChange={(e) => setRate(Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label htmlFor="forceMajeurePct">ФК %</Label>
          <Input
            id="forceMajeurePct"
            name="forceMajeurePct"
            type="number"
            value={fkPct || ""}
            onChange={(e) => setFkPct(Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label>Сумма с ФК</Label>
          <Input value={amountWithFk.toFixed(2)} readOnly className="opacity-70" />
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
          <Label htmlFor="pickupOffsetMin">Подача до готовности</Label>
          <input type="hidden" name="pickupOffsetMin" value={pickupOffset} />
          <HhMmInput
            id="pickupOffsetMin"
            mode="duration"
            value={pickupOffset}
            onChange={setPickupOffset}
            placeholder="01:00"
          />
          <p className="mt-1 text-[10px] text-[var(--muted-fg)]">Формат ЧЧ:ММ</p>
        </div>
      </div>

      <div>
        <h5 className="mb-2 text-sm font-semibold">Стоимость переработки</h5>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--muted-fg)]">
                <th className="py-1 pr-2">Час</th>
                <th className="py-1 pr-2">%</th>
                <th className="py-1 pr-2">Сумма</th>
                <th className="py-1 pr-2">ФК %</th>
                <th className="py-1 pr-2">ФК</th>
                <th className="py-1 pr-2">Сумма с ФК</th>
              </tr>
            </thead>
            <tbody>
              {otRows.map((row) => {
                const computed = computeOvertimeRow(row, rate, fkPct);
                return (
                  <tr key={row.hourNumber}>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {row.hourNumber}-й час
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={`ot_pct_${row.hourNumber}`}
                        inputMode="decimal"
                        placeholder="—"
                        value={row.pct}
                        onChange={(e) =>
                          updateOtRow(row.hourNumber, { pct: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={`ot_amount_${row.hourNumber}`}
                        inputMode="decimal"
                        placeholder="—"
                        value={row.amount}
                        onChange={(e) =>
                          updateOtRow(row.hourNumber, { amount: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={`ot_fk_${row.hourNumber}`}
                        inputMode="decimal"
                        placeholder={fkPct ? String(fkPct) : "—"}
                        value={row.fkPct}
                        onChange={(e) =>
                          updateOtRow(row.hourNumber, { fkPct: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2 text-[var(--muted-fg)]">
                      {computed ? computed.fkAmt.toFixed(2) : "—"}
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
                fkPct: "",
              },
            ])
          }
        >
          + Добавить час
        </Button>
      </div>

      <div>
        <h5 className="mb-2 text-sm font-semibold">Дополнительные выплаты</h5>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--muted-fg)]">
                <th className="py-1 pr-2">Дата</th>
                <th className="py-1 pr-2">Сумма</th>
                <th className="py-1 pr-2">ФК %</th>
                <th className="py-1 pr-2">Сумма с ФК</th>
                <th className="py-1 pr-2">Описание</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {epRows.map((row, i) => {
                const total = computeExtraRow(row, fkPct);
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
                        onChange={(e) =>
                          setEpRows((prev) =>
                            prev.map((r, idx) =>
                              idx === i ? { ...r, amount: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <PayrollTableInput
                        name={`ep_fk_${i}`}
                        inputMode="decimal"
                        placeholder={fkPct ? String(fkPct) : "—"}
                        value={row.forceMajeurePct}
                        onChange={(e) =>
                          setEpRows((prev) =>
                            prev.map((r, idx) =>
                              idx === i
                                ? { ...r, forceMajeurePct: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 pr-2 text-[var(--muted-fg)]">
                      {total != null ? total.toFixed(2) : "—"}
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
                forceMajeurePct: "",
                description: "",
              },
            ])
          }
        >
          + Добавить
        </Button>
      </div>
    </div>
  );
}

export function seedOvertime(
  rates: Array<{
    hourNumber: number;
    percentRate: { toString(): string } | null;
    amount: { toString(): string } | null;
    forceMajeurePct: { toString(): string } | null;
  }>,
): OvertimeSeed[] {
  return rates.map((r) => ({
    hourNumber: r.hourNumber,
    percentRate: toNum(r.percentRate),
    amount: toNum(r.amount),
    forceMajeurePct: toNum(r.forceMajeurePct),
  }));
}

export function seedExtras(
  payments: Array<{
    paymentDate: Date | null;
    amount: { toString(): string };
    forceMajeurePct: { toString(): string } | null;
    description: string | null;
  }>,
): ExtraSeed[] {
  return payments.map((p) => ({
    paymentDate: p.paymentDate
      ? new Date(p.paymentDate).toISOString().slice(0, 10)
      : "",
    amount: String(p.amount),
    forceMajeurePct:
      p.forceMajeurePct != null ? String(p.forceMajeurePct) : "",
    description: p.description ?? "",
  }));
}
