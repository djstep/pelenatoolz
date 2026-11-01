import ExcelJS from "exceljs";
import { MONEY, MONEY_FIELD_NAMES } from "../fixtures/data";

/** Пробелы, неразрывные и узкие пробелы — разделители тысяч в «48 317,53». */
const SPACES = /[\s   ]/g;

function moneyPatterns(): { label: string; re: RegExp }[] {
  return Object.entries(MONEY).flatMap(([label, value]) => {
    const [int, frac] = value.split(".");
    const out = [{ label: `${label}=${value}`, re: new RegExp(`(?<![0-9])${int}[.,]${frac}(?![0-9])`) }];
    // Целая часть отдельно — только длинная (короткие совпадают с хешами и номерами).
    if (int.length >= 5) {
      out.push({ label: `${label}≈${int}`, re: new RegExp(`(?<![0-9A-Za-z])${int}(?![0-9A-Za-z])`) });
    }
    return out;
  });
}

const MONEY_RES = moneyPatterns();
/**
 * Денежное поле со значением: `"kmRate":"58.61"`, `"kmRate":58.61`, `"overtimeRates":[{…}]`
 * (в HTML кавычки экранированы — `\"kmRate\":…`). Пустое значение (`""`, `null`, `[]`) —
 * не утечка: такие поля только перечисляются (`mentionedMoneyFields`).
 */
const FIELD_RES = MONEY_FIELD_NAMES.map((name) => ({
  label: `поле ${name} со значением`,
  re: new RegExp(
    String.raw`(?<![A-Za-z0-9_$])${name}\\*"\s*:\s*(?:\\*"(?!\\*")|-?[0-9]|\[\s*[^\]\s]|\{\s*[^}\s])`,
  ),
}));

const MENTION_RES = MONEY_FIELD_NAMES.map((name) => ({
  name,
  re: new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_])`),
}));

/** Имена денежных полей, которые встречаются в тексте (в том числе с пустым значением). */
export function mentionedMoneyFields(text: string): string[] {
  return MENTION_RES.filter(({ re }) => re.test(text)).map(({ name }) => name);
}

export type Leak = { where: string; what: string; around: string };

/** Ставки и денежные поля в тексте ответа: суммы — без пробелов, поля — по имени. */
export function findLeaks(where: string, text: string): Leak[] {
  const leaks: Leak[] = [];
  const compact = text.replace(SPACES, "");
  for (const { label, re } of MONEY_RES) {
    const m = re.exec(compact);
    if (m) leaks.push({ where, what: label, around: compact.slice(Math.max(0, m.index - 60), m.index + 40) });
  }
  for (const { label, re } of FIELD_RES) {
    const m = re.exec(text);
    if (m) leaks.push({ where, what: label, around: text.slice(Math.max(0, m.index - 80), m.index + 60) });
  }
  return leaks;
}

/** Все значения ячеек книги одной строкой (числа, строки, формулы, rich text). */
export async function workbookText(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(`[${sheet.name}]`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown;
        if (v == null) return;
        if (typeof v === "object") parts.push(JSON.stringify(v));
        else parts.push(String(v));
      });
    });
  });
  return parts.join("\n");
}
