import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";

export type OvertimeRateInput = {
  hourNumber: number;
  percentRate: number | null;
  amount: number | null;
  forceMajeurePct: number | null;
};

export type WorkPayInput = {
  factStart: string | null | undefined;
  factEnd: string | null | undefined;
  lunchSkipped: boolean;
  shiftHoursMin: number | null | undefined;
  unpaidOvertimeMin: number | null | undefined;
  shiftRate: number | null | undefined;
  forceMajeurePct: number | null | undefined;
  overtimeRates?: OvertimeRateInput[];
  extrasTotal?: number;
};

export type WorkPayResult = {
  workedMin: number | null;
  factOvertimeMin: number | null;
  payableOvertimeMin: number | null;
  shiftPay: number | null;
  overtimePay: number | null;
  extrasPay: number;
  totalPay: number | null;
  /** true when fact times are filled — OT can be computed */
  hasExactTime: boolean;
};

function toMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesBetween(start: string, end: string): number {
  const diff = toMin(end) - toMin(start);
  // night shift wrap past midnight
  return diff >= 0 ? diff : diff + 1440;
}

function withFk(amount: number, fkPct: number): number {
  return amount + (amount * fkPct) / 100;
}

function roundUpToHourMinutes(mins: number): number {
  if (mins <= 0) return 0;
  return Math.ceil(mins / 60) * 60;
}

/**
 * Переработка:
 * - факт = max(0, отработано − длительность смены); при Т/О не меньше 60 мин
 * - оплачиваемая = max(0, факт − неоплач. переработка), округление вверх до часа
 */
export function computeWorkPay(input: WorkPayInput): WorkPayResult {
  const shiftRate = input.shiftRate != null ? Number(input.shiftRate) : null;
  const fkPct = input.forceMajeurePct != null ? Number(input.forceMajeurePct) : 0;
  const extrasPay = input.extrasTotal ?? 0;
  const shiftHoursMin = input.shiftHoursMin ?? null;
  const unpaid = input.unpaidOvertimeMin ?? 0;

  const shiftPay =
    shiftRate != null && shiftRate > 0 ? withFk(shiftRate, fkPct) : null;

  const start = input.factStart?.trim() || "";
  const end = input.factEnd?.trim() || "";
  const hasExactTime = Boolean(start && end);

  if (!hasExactTime) {
    // Без точного времени — только базовая смена, без переработки
    const total =
      shiftPay != null || extrasPay !== 0
        ? (shiftPay ?? 0) + extrasPay
        : null;
    return {
      workedMin: null,
      factOvertimeMin: null,
      payableOvertimeMin: null,
      shiftPay,
      overtimePay: null,
      extrasPay,
      totalPay: total,
      hasExactTime: false,
    };
  }

  const workedMin = minutesBetween(start, end);
  const contracted = shiftHoursMin != null && shiftHoursMin > 0 ? shiftHoursMin : workedMin;
  let factOt = Math.max(0, workedMin - contracted);

  // Т/О: даже при недоработке полной смены фиксируем минимум час переработки
  if (input.lunchSkipped) {
    factOt = Math.max(factOt, 60);
  }

  const payableRaw = Math.max(0, factOt - unpaid);
  const payableOvertimeMin = roundUpToHourMinutes(payableRaw);

  let overtimePay: number | null = null;
  if (payableOvertimeMin > 0 && shiftRate != null && shiftRate > 0) {
    const hours = payableOvertimeMin / 60;
    const rates = input.overtimeRates ?? [];
    if (rates.length > 0) {
      let sum = 0;
      for (let h = 1; h <= hours; h++) {
        const rate = rates.find((r) => r.hourNumber === h);
        if (!rate) continue;
        let amount =
          rate.amount != null && !Number.isNaN(rate.amount)
            ? Number(rate.amount)
            : rate.percentRate != null
              ? (shiftRate * Number(rate.percentRate)) / 100
              : 0;
        const rowFk =
          rate.forceMajeurePct != null ? Number(rate.forceMajeurePct) : fkPct;
        sum += withFk(amount, rowFk);
      }
      overtimePay = sum;
    } else if (shiftHoursMin && shiftHoursMin > 0) {
      const hourly = shiftRate / (shiftHoursMin / 60);
      overtimePay = withFk(hourly * hours, fkPct);
    } else {
      overtimePay = withFk((shiftRate / 12) * hours, fkPct);
    }
  } else if (payableOvertimeMin === 0) {
    overtimePay = 0;
  }

  const totalPay =
    (shiftPay ?? 0) + (overtimePay ?? 0) + extrasPay;

  return {
    workedMin,
    factOvertimeMin: factOt,
    payableOvertimeMin,
    shiftPay,
    overtimePay,
    extrasPay,
    totalPay: shiftPay != null || overtimePay != null || extrasPay !== 0 ? totalPay : null,
    hasExactTime: true,
  };
}

export function formatOvertimeCell(
  factMin: number | null | undefined,
  payableMin: number | null | undefined,
): string {
  if (factMin == null && payableMin == null) return "—";
  const fact = formatMinutesHhMm(factMin ?? 0) || "00:00";
  const payable = formatMinutesHhMm(payableMin ?? 0) || "00:00";
  return `${fact} (${payable})`;
}

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return amount.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
