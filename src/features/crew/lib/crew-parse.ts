import type { CounterpartyType } from "@prisma/client";

/**
 * Разбор данных контрагента для «Подтянуть из договоров». В контрагенте имя — одна строка,
 * контакты — свободный текст, поэтому результат только предложение: окно показывает его в
 * редактируемых полях. Ошибка разбора не должна что-то ломать, только дать поле для правки.
 */

export type ParsedName = {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
};

export type ParsedContacts = { phone: string | null; email: string | null };

const LABEL = "индивидуальный\\s+предприниматель|ип|самозанят(?:ый|ая)";
// Граница слова `\b` с кириллицей не работает: без проверки следующего знака «Ипатов» потерял бы начало.
const LABEL_PREFIX = new RegExp(`^(?:${LABEL})(?=[\\s,.:;-]|$)[\\s,.:;-]*`, "iu");
const LABEL_SUFFIX = new RegExp(`[\\s,-]+(?:${LABEL})[\\s.]*$`, "iu");
/** «И.П.» с точками может быть и инициалами, поэтому убирается только у типа «ИП». */
const DOTTED_IP = /^и\.\s*п\.[\s,]*/iu;
const INITIAL = /^\p{L}\.$/u;
const PATRONYMIC = /(?:вич|ьич|вна|чна|шна)$/iu;
const TURKIC_PATRONYMIC = new Set(["оглы", "кызы", "улы", "гызы"]);

function splitTokens(name: string, type?: CounterpartyType): string[] {
  let text = name.replace(/[«»"“”„()]/g, " ").replace(/\s+/g, " ").trim();
  if (type === "IP") text = text.replace(DOTTED_IP, "");
  text = text
    .replace(LABEL_PREFIX, "")
    .replace(LABEL_SUFFIX, "")
    // «Петрова - Водкина» и тире вместо дефиса — одна фамилия.
    .replace(/(\p{L})\s*[-‐-―]\s*(\p{L})/gu, "$1-$2")
    // «И.И.» — два инициала.
    .replace(/(\p{L}\.)(?=\p{L})/gu, "$1 ");
  const tokens = text.split(/\s+/).filter(Boolean);
  // «И. И. Иванов»: фамилия в конце.
  if (tokens.length > 1 && tokens.slice(0, -1).every((t) => INITIAL.test(t))) {
    return [tokens[tokens.length - 1], ...tokens.slice(0, -1)];
  }
  return tokens;
}

/** Фамилия, имя, отчество из названия контрагента, без «ИП» и кавычек. */
export function parseCounterpartyName(name: string, type?: CounterpartyType): ParsedName {
  const tokens = splitTokens(name, type);
  const n = tokens.length;
  if (n <= 3) {
    return { lastName: tokens[0] ?? "", firstName: tokens[1] ?? null, middleName: tokens[2] ?? null };
  }
  const tail = tokens[n - 1];
  if (TURKIC_PATRONYMIC.has(tail.toLocaleLowerCase("ru"))) {
    return {
      lastName: tokens.slice(0, n - 3).join(" "),
      firstName: tokens[n - 3],
      middleName: `${tokens[n - 2]} ${tail}`,
    };
  }
  // Четыре слова и отчество в конце: фамилия двойная, через пробел.
  if (PATRONYMIC.test(tail)) {
    return {
      lastName: tokens.slice(0, n - 2).join(" "),
      firstName: tokens[n - 2],
      middleName: tail,
    };
  }
  return { lastName: tokens[0], firstName: tokens[1], middleName: tokens.slice(2).join(" ") };
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

const SEP = "[\\s\\-–—]*";
const PHONE = new RegExp(
  "(?<![\\d+])(?:" +
    // Россия: +7 / 7 / 8, ровно 11 цифр. Отдельной веткой — иначе два номера через пробел слипнутся.
    "(?:\\+7|8|7)[\\s\\-–—.]*\\(?\\d{3}\\)?[\\s\\-–—.]*\\d{3}[\\s\\-–—.]*\\d{2}[\\s\\-–—.]*\\d{2}" +
    // Другие страны: с плюсом.
    "|\\+\\d(?:[\\s\\-–—.()]{0,2}\\d){6,14}" +
    // Код города без страны: 10 цифр.
    `|\\(?\\d{3,5}\\)?${SEP}\\d{1,3}${SEP}\\d{2}${SEP}\\d{2}` +
    // Городской без кода: 123-45-67.
    "|\\d{3}[\\s\\-–—]\\d{2}[\\s\\-–—]\\d{2}" +
    ")(?!\\d)",
  "gu",
);

/** Числа с такой подписью перед ними — реквизиты, а не телефон. */
const REQUISITE_LABEL =
  /(?:инн|огрн(?:ип)?|кпп|бик|окпо|р\s*\/?\s*с|к\s*\/?\s*с|сч[её]т|паспорт|серия|№)[\s:.№#]*$/iu;

function isPhoneLength(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  if (match.startsWith("+")) return digits.length >= 8 && digits.length <= 15;
  if (digits.length === 11) return /^[78]/.test(digits);
  return digits.length === 10 || digits.length === 7;
}

function firstPhone(text: string): string | null {
  for (const match of text.matchAll(PHONE)) {
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    if (isPhoneLength(match[0]) && !REQUISITE_LABEL.test(before)) return match[0].trim();
  }
  return null;
}

/** Первый телефон и первая почта из свободного текста контактов. Телефон — как написан. */
export function parseContacts(text: string | null | undefined): ParsedContacts {
  if (!text) return { phone: null, email: null };
  const email = text.match(EMAIL)?.[0] ?? null;
  // Цифры внутри почты — не телефон.
  return { phone: firstPhone(text.replace(EMAIL, " ")), email };
}
