"use client";

import { useMemo, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

type OvertimeSeed = {
  hourNumber: number;
  percentRate: number | null;
  amount: number | null;
  forceMajeurePct: number | null;
};

type ExtraSeed = {
  paymentDate: string;
  amount: number;
  forceMajeurePct: number | null;
  description: string;
};

function toNum(v: { toString(): string } | number | null | undefined) {
  if (v == null) return null;
  return Number(v);
}

export function ActorPayrollBlock({
  shiftRate = 0,
  forceMajeurePct = 0,
  shiftHoursMin,
  unpaidOvertimeMin,
  overtime = [],
  extras = [],
}: {
  shiftRate?: number;
  forceMajeurePct?: number;
  shiftHoursMin?: number | null;
  unpaidOvertimeMin?: number | null;
  overtime?: OvertimeSeed[];
  extras?: ExtraSeed[];
}) {
  const [otCount, setOtCount] = useState(Math.max(4, overtime.length || 4));
  const [epRows, setEpRows] = useState(
    extras.length
      ? extras
      : [{ paymentDate: "", amount: 0, forceMajeurePct: null, description: "" }],
  );
  const [fkPct, setFkPct] = useState(forceMajeurePct);
  const [rate, setRate] = useState(shiftRate);

  const amountWithFk = useMemo(
    () => rate + (rate * fkPct) / 100,
    [rate, fkPct],
  );

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
          <Label htmlFor="shiftHoursMin">Продолжительность смены (мин)</Label>
          <Input
            id="shiftHoursMin"
            name="shiftHoursMin"
            type="number"
            placeholder="720"
            defaultValue={shiftHoursMin ?? undefined}
          />
        </div>
        <div>
          <Label htmlFor="unpaidOvertimeMin">Неоплачиваемая переработка (мин)</Label>
          <Input
            id="unpaidOvertimeMin"
            name="unpaidOvertimeMin"
            type="number"
            defaultValue={unpaidOvertimeMin ?? undefined}
          />
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
              {Array.from({ length: otCount }, (_, idx) => {
                const hour = idx + 1;
                const seed = overtime.find((o) => o.hourNumber === hour);
                const pct = seed?.percentRate ?? "";
                const amount =
                  seed?.amount ??
                  (seed?.percentRate != null && rate
                    ? (rate * seed.percentRate) / 100
                    : "");
                const rowFk = seed?.forceMajeurePct ?? fkPct;
                const amtNum = Number(amount) || 0;
                const fkAmt = (amtNum * (Number(rowFk) || 0)) / 100;
                return (
                  <tr key={hour}>
                    <td className="py-1 pr-2 whitespace-nowrap">{hour}-й час</td>
                    <td className="py-1 pr-2">
                      <Input
                        name={`ot_pct_${hour}`}
                        type="number"
                        defaultValue={pct === "" ? undefined : pct}
                        className="w-20"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        name={`ot_amount_${hour}`}
                        type="number"
                        defaultValue={amount === "" ? undefined : amount}
                        className="w-28"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        name={`ot_fk_${hour}`}
                        type="number"
                        defaultValue={rowFk || undefined}
                        className="w-20"
                      />
                    </td>
                    <td className="py-1 pr-2 opacity-70">{fkAmt.toFixed(2)}</td>
                    <td className="py-1 pr-2 opacity-70">
                      {(amtNum + fkAmt).toFixed(2)}
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
          onClick={() => setOtCount((c) => c + 1)}
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
                const rowFk = row.forceMajeurePct ?? fkPct;
                const total = row.amount + (row.amount * (rowFk || 0)) / 100;
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
                              idx === i ? { ...r, paymentDate: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        name={`ep_amount_${i}`}
                        type="number"
                        value={row.amount || ""}
                        onChange={(e) =>
                          setEpRows((prev) =>
                            prev.map((r, idx) =>
                              idx === i
                                ? { ...r, amount: Number(e.target.value) || 0 }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        name={`ep_fk_${i}`}
                        type="number"
                        value={rowFk || ""}
                        onChange={(e) =>
                          setEpRows((prev) =>
                            prev.map((r, idx) =>
                              idx === i
                                ? {
                                    ...r,
                                    forceMajeurePct: Number(e.target.value) || 0,
                                  }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 pr-2 opacity-70">{total.toFixed(2)}</td>
                    <td className="py-1 pr-2">
                      <Input
                        name={`ep_desc_${i}`}
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
                amount: 0,
                forceMajeurePct: null,
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
    amount: Number(p.amount),
    forceMajeurePct: toNum(p.forceMajeurePct),
    description: p.description ?? "",
  }));
}
