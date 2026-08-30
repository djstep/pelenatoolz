export type CurrencyOption = {
  value: string;
  label: string;
  search: string;
};

const ISO_CODES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HRK",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
  "ZWL",
] as const;

const displayNames = new Intl.DisplayNames(["ru", "en"], { type: "currency" });

function buildCurrencyLabel(code: string) {
  const name = displayNames.of(code);
  return name ? `${code} — ${name}` : code;
}

const ALL_CURRENCIES: CurrencyOption[] = ISO_CODES.map((code) => {
  const label = buildCurrencyLabel(code);
  return {
    value: code,
    label,
    search: `${code} ${label}`.toLowerCase(),
  };
});

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

export function searchCurrencies(query: string, limit = 12): CurrencyOption[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const startsWithCode: CurrencyOption[] = [];
  const startsWithName: CurrencyOption[] = [];
  const includes: CurrencyOption[] = [];

  for (const option of ALL_CURRENCIES) {
    if (option.value.toLowerCase().startsWith(q)) {
      startsWithCode.push(option);
      continue;
    }
    const namePart = option.label.split(" — ")[1]?.toLowerCase() ?? "";
    if (namePart.startsWith(q)) {
      startsWithName.push(option);
      continue;
    }
    if (option.search.includes(q)) {
      includes.push(option);
    }
  }

  return [...startsWithCode, ...startsWithName, ...includes].slice(0, limit);
}

export function resolveCurrency(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!code) return null;
  const exact = ALL_CURRENCIES.find((c) => c.value === code);
  if (exact) return exact.value;

  const matches = searchCurrencies(code, 1);
  return matches[0]?.value ?? null;
}

export function currencyLabel(code: string) {
  const exact = ALL_CURRENCIES.find((c) => c.value === code.toUpperCase());
  return exact?.label ?? code.toUpperCase();
}
