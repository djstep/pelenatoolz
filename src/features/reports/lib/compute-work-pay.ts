import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";

export type OvertimeCalcMode =
  | "HALF_HOUR"
  | "HOURLY_CUMULATIVE"
  | "HOURLY_FLAT";

export type UnpaidOvertimeMode = "FIRST_HOUR" | "EACH_HOUR";

export type OvertimeRateInput = {
  hourNumber: number;
  percentRate: number | null;
  amount: number | null;
  taxPercent: number | null;
};

export type WorkPayInput = {
  factStart: string | null | undefined;
  factEnd: string | null | undefined;
  lunchSkipped: boolean;
  shiftHoursMin: number | null | undefined;
  unpaidOvertimeMin: number | null | undefined;
  shiftRate: number | null | undefined;
  taxPercent: number | null | undefined;
  overtimeMode?: OvertimeCalcMode | null;
  unpaidOvertimeMode?: UnpaidOvertimeMode | null;
  overtimeRates?: OvertimeRateInput[];
  extrasTotal?: number;
  factKm?: number | null;
  kmRate?: number | null;
};

export type WorkPayResult = {
  workedMin: number | null;
  factOvertimeMin: number | null;
  payableOvertimeMin: number | null;
  shiftPay: number | null;
  overtimePay: number | null;
  extrasPay: number;
  mileagePay: number;
  totalPay: number | null;
  hasExactTime: boolean;
};

const DEFAULT_SHIFT_HOURS_MIN = 12 * 60;

function toMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesBetween(start: string, end: string): number {
  const diff = toMin(end) - toMin(start);
  return diff >= 0 ? diff : diff + 1440;
}

export function withTax(amount: number, taxPct: number): number {
  return amount + (amount * taxPct) / 100;
}

export function taxAmountFromBase(base: number, taxPct: number): number {
  return (base * taxPct) / 100;
}

/** Обратный расчёт: из суммы с налогом и суммы налога → база и ставка %. */
export function reverseFromGross(input: {
  amountWithTax: number;
  taxAmount: number;
}): { base: number; taxPercent: number } {
  const base = Math.max(0, input.amountWithTax - input.taxAmount);
  const taxPercent = base > 0 ? (input.taxAmount / base) * 100 : 0;
  return { base, taxPercent };
}

function ceilToInterval(mins: number, intervalMin: number): number {
  if (mins <= 0) return 0;
  return Math.ceil(mins / intervalMin) * intervalMin;
}

/**
 * Неоплачиваемый буфер → оплачиваемые минуты (ещё до округления по интервалу тарифа).
 */
export function applyUnpaidBuffer(
  factOtMin: number,
  unpaidMin: number,
  mode: UnpaidOvertimeMode,
): number {
  if (factOtMin <= 0) return 0;
  const unpaid = Math.max(0, unpaidMin);

  if (mode === "EACH_HOUR") {
    let remaining = factOtMin;
    let payable = 0;
    while (remaining > 0) {
      const chunk = Math.min(60, remaining);
      remaining -= chunk;
      payable += Math.max(0, chunk - unpaid);
    }
    return payable;
  }

  return Math.max(0, factOtMin - unpaid);
}

function resolveRateAmount(
  rate: OvertimeRateInput | undefined,
  shiftRate: number,
): number {
  if (!rate) return 0;
  if (rate.amount != null && !Number.isNaN(rate.amount)) return Number(rate.amount);
  if (rate.percentRate != null && !Number.isNaN(rate.percentRate)) {
    return (shiftRate * Number(rate.percentRate)) / 100;
  }
  return 0;
}

function lastFilledRate(
  rates: OvertimeRateInput[],
  upToHour: number,
): OvertimeRateInput | undefined {
  const sorted = [...rates]
    .filter((r) => r.hourNumber <= upToHour)
    .sort((a, b) => a.hourNumber - b.hourNumber);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i]!;
    if (
      (r.amount != null && !Number.isNaN(r.amount)) ||
      (r.percentRate != null && !Number.isNaN(r.percentRate))
    ) {
      return r;
    }
  }
  return undefined;
}

function rateForHour(
  rates: OvertimeRateInput[],
  hour: number,
): OvertimeRateInput | undefined {
  const exact = rates.find((r) => r.hourNumber === hour);
  if (
    exact &&
    ((exact.amount != null && !Number.isNaN(exact.amount)) ||
      (exact.percentRate != null && !Number.isNaN(exact.percentRate)))
  ) {
    return exact;
  }
  return lastFilledRate(rates, hour);
}

function computeOvertimePayAmount(input: {
  payableMin: number;
  shiftRate: number;
  taxPct: number;
  mode: OvertimeCalcMode;
  rates: OvertimeRateInput[];
}): number {
  const { payableMin, shiftRate, taxPct, mode, rates } = input;
  if (payableMin <= 0 || shiftRate <= 0) return 0;

  if (mode === "HALF_HOUR") {
    const units = payableMin / 30;
    const unitRate = rateForHour(rates, 1);
    const amount = resolveRateAmount(unitRate, shiftRate);
    const rowTax =
      unitRate?.taxPercent != null ? Number(unitRate.taxPercent) : taxPct;
    return withTax(amount * units, rowTax);
  }

  const hours = payableMin / 60;

  if (mode === "HOURLY_FLAT") {
    const hourCount = Math.max(1, Math.round(hours));
    const rate = rateForHour(rates, hourCount);
    const amount = resolveRateAmount(rate, shiftRate);
    const rowTax = rate?.taxPercent != null ? Number(rate.taxPercent) : taxPct;
    return withTax(amount, rowTax);
  }

  let sum = 0;
  const hourCount = Math.max(1, Math.round(hours));
  for (let h = 1; h <= hourCount; h++) {
    const rate = rateForHour(rates, h);
    const amount = resolveRateAmount(rate, shiftRate);
    const rowTax = rate?.taxPercent != null ? Number(rate.taxPercent) : taxPct;
    sum += withTax(amount, rowTax);
  }
  return sum;
}

export function computeMileagePay(
  factKm: number | null | undefined,
  kmRate: number | null | undefined,
): number {
  const km = factKm != null ? Number(factKm) : 0;
  const rate = kmRate != null ? Number(kmRate) : 0;
  if (!Number.isFinite(km) || !Number.isFinite(rate) || km <= 0 || rate <= 0) {
    return 0;
  }
  return Math.round(km * rate * 100) / 100;
}

export function computeWorkPay(input: WorkPayInput): WorkPayResult {
  const shiftRate = input.shiftRate != null ? Number(input.shiftRate) : null;
  const taxPct = input.taxPercent != null ? Number(input.taxPercent) : 0;
  const extrasPay = input.extrasTotal ?? 0;
  const mileagePay = computeMileagePay(input.factKm, input.kmRate);
  const shiftHoursMin =
    input.shiftHoursMin != null && input.shiftHoursMin > 0
      ? input.shiftHoursMin
      : DEFAULT_SHIFT_HOURS_MIN;
  const unpaid = input.unpaidOvertimeMin ?? 0;
  const overtimeMode: OvertimeCalcMode =
    input.overtimeMode ?? "HOURLY_CUMULATIVE";
  const unpaidMode: UnpaidOvertimeMode =
    input.unpaidOvertimeMode ?? "FIRST_HOUR";
  const intervalMin = overtimeMode === "HALF_HOUR" ? 30 : 60;

  const shiftPay =
    shiftRate != null && shiftRate > 0 ? withTax(shiftRate, taxPct) : null;

  const start = input.factStart?.trim() || "";
  const end = input.factEnd?.trim() || "";
  const hasExactTime = Boolean(start && end);

  if (!hasExactTime) {
    const total =
      shiftPay != null || extrasPay !== 0 || mileagePay !== 0
        ? (shiftPay ?? 0) + extrasPay + mileagePay
        : null;
    return {
      workedMin: null,
      factOvertimeMin: null,
      payableOvertimeMin: null,
      shiftPay,
      overtimePay: null,
      extrasPay,
      mileagePay,
      totalPay: total,
      hasExactTime: false,
    };
  }

  const workedMin = minutesBetween(start, end);
  // Т/О: текущий обед оплачивается как +1 час к времени для расчёта стоимости
  const billableWorkedMin = input.lunchSkipped ? workedMin + 60 : workedMin;
  const factOt = Math.max(0, billableWorkedMin - shiftHoursMin);

  const afterBuffer = applyUnpaidBuffer(factOt, unpaid, unpaidMode);
  const payableOvertimeMin = ceilToInterval(afterBuffer, intervalMin);

  let overtimePay: number | null = null;
  if (payableOvertimeMin > 0 && shiftRate != null && shiftRate > 0) {
    const rates = input.overtimeRates ?? [];
    if (rates.length > 0) {
      overtimePay = computeOvertimePayAmount({
        payableMin: payableOvertimeMin,
        shiftRate,
        taxPct,
        mode: overtimeMode,
        rates,
      });
    } else {
      const hours = payableOvertimeMin / 60;
      const hourly = shiftRate / (shiftHoursMin / 60);
      overtimePay = withTax(hourly * hours, taxPct);
    }
  } else if (payableOvertimeMin === 0) {
    overtimePay = 0;
  }

  const totalPay =
    (shiftPay ?? 0) + (overtimePay ?? 0) + extrasPay + mileagePay;

  return {
    workedMin,
    factOvertimeMin: factOt,
    payableOvertimeMin,
    shiftPay,
    overtimePay,
    extrasPay,
    mileagePay,
    totalPay:
      shiftPay != null ||
      overtimePay != null ||
      extrasPay !== 0 ||
      mileagePay !== 0
        ? totalPay
        : null,
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

export const OVERTIME_MODE_LABELS: Record<OvertimeCalcMode, string> = {
  HALF_HOUR: "Получасовые",
  HOURLY_CUMULATIVE: "Часовые (суммируются)",
  HOURLY_FLAT: "Часовые (не суммируются)",
};

export const UNPAID_OT_MODE_LABELS: Record<UnpaidOvertimeMode, string> = {
  FIRST_HOUR: "Окончание смены (первый час)",
  EACH_HOUR: "Общее время переработки",
};
