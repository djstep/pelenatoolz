import { compareKey } from "@/features/import/normalize/text";

/** Титульная страница: всё до первой шапки. Дата — как текст, не разбирается. */
export type TitlePage = {
  title: string | null;
  subtitle: string | null;
  author: string | null;
  version: string | null;
  date: string | null;
  city: string | null;
  other: string[];
  /** Строки с почтой или телефоном: в версию сохраняются, в журнал аудита — нет. */
  contacts: string[];
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/u;
const PHONE_RE = /\+?\d[\d\s()-]{8,}\d/;
const DATE_RE =
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}/iu;
const VERSION_RE = /верси|редакци|драфт|draft|version/iu;
const AUTHOR_LABEL_RE =
  /^(?:авторы?(?:\s+сценария)?|сценарист(?:ка)?|сценарий\s*(?=:))(?=\s|:|$)\s*:?\s*(.*)$/iu;

/** Строки-заголовки, которые не название: «СЦЕНАРИЙ». */
const SERVICE_LINES = new Set(["СЦЕНАРИЙ", "SCREENPLAY"]);

/** Города для поля «город». Расширяемый список; «г. …» — тоже город. */
export const TITLE_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Петербург",
  "Екатеринбург",
  "Новосибирск",
  "Казань",
  "Нижний Новгород",
  "Калининград",
  "Сочи",
  "Краснодар",
  "Ростов-на-Дону",
  "Самара",
  "Владивосток",
  "Минск",
];

const CITY_KEYS = new Set(TITLE_CITIES.map((city) => compareKey(city)));

function cityOf(line: string) {
  const prefixed = /^г\.\s*/iu.test(line);
  const name = line
    .replace(/^г\.\s*/iu, "")
    .replace(/[,\s]+\d{4}\s*г?\.?$/u, "")
    .trim();
  if (!name) return null;
  return prefixed || CITY_KEYS.has(compareKey(name)) ? name : null;
}

export function parseTitlePage(source: string[]): TitlePage | null {
  const lines = source.filter(Boolean);
  if (lines.length === 0) return null;

  const page: TitlePage = {
    title: null,
    subtitle: null,
    author: null,
    version: null,
    date: null,
    city: null,
    other: [],
    contacts: [],
  };
  let titleAt = -1;
  let authorPending = false;

  lines.forEach((line, i) => {
    const phone = line.match(PHONE_RE)?.[0];
    if (EMAIL_RE.test(line) || (phone && phone.replace(/\D/g, "").length >= 10)) {
      page.contacts.push(line);
      return;
    }
    if (!page.version && VERSION_RE.test(line)) {
      page.version = line;
      return;
    }
    if (!page.date && DATE_RE.test(line)) {
      page.date = line;
      return;
    }
    const city = page.city ? null : cityOf(line);
    if (city) {
      page.city = city;
      return;
    }
    const label = line.match(AUTHOR_LABEL_RE);
    if (label) {
      if (label[1] && !page.author) {
        page.author = label[1];
      } else {
        page.other.push(line);
        authorPending = !page.author;
      }
      return;
    }
    if (authorPending) {
      page.author = line;
      authorPending = false;
      return;
    }
    if (!page.title && !SERVICE_LINES.has(compareKey(line))) {
      page.title = line;
      titleAt = i;
      return;
    }
    // Первая строка без метки сразу после названия — подзаголовок.
    if (!page.subtitle && titleAt >= 0 && titleAt === i - 1) {
      page.subtitle = line;
      return;
    }
    page.other.push(line);
  });

  return page;
}
