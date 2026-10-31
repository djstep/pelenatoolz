import { stripHtml } from "@/features/screenplay/lib/plain-text";

/**
 * Безопасный показ блока сценария (пункт 4 аудита, минимум шага 7 волны 4).
 * `contentHtml` из базы не вставляется через `innerHTML`: он разбирается здесь, из него
 * остаются только теги панели форматирования (жирный, курсив, подчёркнутый, зачёркнутый,
 * перенос строки, цвет текста и фона), а страница собирается из узлов (`createElement`,
 * `createTextNode`). Цвет — только `#rgb`, `#rrggbb`, `rgb(…)`, `rgba(…)`.
 * Всё остальное — просто текст. Без `contentHtml` блок — только текст.
 */

export type SafeColor = { color?: string; backgroundColor?: string };
export type SafeNode =
  | { text: string }
  | { tag: SafeTag; colors: SafeColor; children: SafeNode[] };

/** Что даёт панель форматирования и сам редактор (`div`/`p` — перенос строки в Chrome). */
const SAFE_TAGS = ["b", "strong", "i", "em", "u", "s", "strike", "del", "span", "font", "div", "p", "br"] as const;
type SafeTag = (typeof SAFE_TAGS)[number];
const SAFE_TAG_SET: ReadonlySet<string> = new Set(SAFE_TAGS);
/** Содержимое этих тегов — не текст сценария, выбрасывается целиком. */
const DROP_CONTENT = new Set(["script", "style", "template", "textarea", "title", "iframe", "object", "noscript", "svg", "math"]);
const VOID_TAGS = new Set(["br", "img", "hr", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_COLOR =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,4}|1\.0{1,4})\s*)?\)$/i;

export function safeColor(value: string | null | undefined): string | undefined {
  const color = value?.trim();
  if (!color) return undefined;
  return HEX_COLOR.test(color) || RGB_COLOR.test(color) ? color : undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Значение атрибута из строки атрибутов тега: `name="…"`, `name='…'`, `name=…`. */
function attribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function colorsOf(tag: string, attrs: string): SafeColor {
  const colors: SafeColor = {};
  if (tag === "font") {
    const color = safeColor(attribute(attrs, "color"));
    if (color) colors.color = color;
  }
  if (tag === "span" || tag === "font") {
    for (const declaration of (attribute(attrs, "style") ?? "").split(";")) {
      const at = declaration.indexOf(":");
      if (at < 0) continue;
      const property = declaration.slice(0, at).trim().toLowerCase();
      const value = safeColor(declaration.slice(at + 1));
      if (!value) continue;
      if (property === "color") colors.color = value;
      if (property === "background-color") colors.backgroundColor = value;
    }
  }
  return colors;
}

/** Разбор `contentHtml` в дерево только из разрешённого. Чистая функция, без DOM. */
export function parseBlockHtml(html: string): SafeNode[] {
  const root: SafeNode[] = [];
  type Open = { name: string; children: SafeNode[] };
  const stack: Open[] = [{ name: "#root", children: root }];
  let dropping: string | null = null;
  const token = /<!--[\s\S]*?(?:-->|$)|<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|<|[^<]+/g;

  for (const match of html.matchAll(token)) {
    const [whole, rawName, attrs = ""] = match;
    if (whole.startsWith("<!--")) continue;
    const top = stack[stack.length - 1]!;
    if (!rawName) {
      if (!dropping) top.children.push({ text: decodeEntities(whole) });
      continue;
    }
    const name = rawName.toLowerCase();
    const closing = whole[1] === "/";

    if (dropping) {
      if (closing && name === dropping) dropping = null;
      continue;
    }
    if (closing) {
      // Закрываем до своего открытия; лишний закрывающий тег — пропускаем.
      const at = stack.map((o) => o.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    if (DROP_CONTENT.has(name)) {
      if (!/\/\s*$/.test(attrs)) dropping = name;
      continue;
    }
    if (!SAFE_TAG_SET.has(name)) {
      // Чужой тег: сам не переносится, его текст — переносится (в текущий родитель).
      continue;
    }
    const tag = name as SafeTag;
    const node: SafeNode = { tag, colors: colorsOf(tag, attrs), children: [] };
    top.children.push(node);
    if (!VOID_TAGS.has(tag)) stack.push({ name: tag, children: node.children });
  }
  return root;
}

function escapeText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;");
}

function styleText(colors: SafeColor) {
  const parts = [
    colors.color ? `color: ${colors.color};` : null,
    colors.backgroundColor ? `background-color: ${colors.backgroundColor};` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function serialize(nodes: readonly SafeNode[]): string {
  return nodes
    .map((node) => {
      if ("text" in node) return escapeText(node.text);
      if (node.tag === "br") return "<br>";
      let attrs = "";
      if (node.tag === "font") {
        if (node.colors.color) attrs += ` color="${node.colors.color}"`;
        if (node.colors.backgroundColor) {
          attrs += ` style="${styleText({ backgroundColor: node.colors.backgroundColor })}"`;
        }
      } else if (node.tag === "span") {
        const style = styleText(node.colors);
        if (style) attrs += ` style="${style}"`;
      }
      return `<${node.tag}${attrs}>${serialize(node.children)}</${node.tag}>`;
    })
    .join("");
}

/**
 * Безопасный HTML блока строкой — то, что будет в редакторе после показа (для сравнения
 * с `innerHTML` и для тестов; на страницу строка не вставляется).
 */
export function safeBlockHtml(content: string, contentHtml?: string | null) {
  return contentHtml?.trim() ? serialize(parseBlockHtml(contentHtml)) : escapeText(content);
}

/** Узлы блока для редактора: из `contentHtml` — только разрешённое, иначе текст. */
export function blockNodes(doc: Document, content: string, contentHtml?: string | null): Node[] {
  if (!contentHtml?.trim()) return content ? [doc.createTextNode(content)] : [];
  const build = (nodes: readonly SafeNode[]): Node[] =>
    nodes.map((node) => {
      if ("text" in node) return doc.createTextNode(node.text);
      const el = doc.createElement(node.tag);
      if (node.tag === "font" && node.colors.color) el.setAttribute("color", node.colors.color);
      else if (node.colors.color) el.style.color = node.colors.color;
      if (node.colors.backgroundColor) el.style.backgroundColor = node.colors.backgroundColor;
      el.append(...build(node.children));
      return el;
    });
  return build(parseBlockHtml(contentHtml));
}

/**
 * Что сохранить после правки: текст и HTML из редактора. HTML сохраняется, только если
 * в нём есть разметка (иначе `contentHtml` пустой) — правка текста форматирование не теряет.
 */
export function blockFromEditorHtml(html: string): { content: string; contentHtml: string | null } {
  const text = stripHtml(html);
  return { content: text, contentHtml: html === text ? null : html };
}
