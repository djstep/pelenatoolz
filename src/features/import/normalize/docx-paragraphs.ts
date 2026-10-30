import { readDocxParts } from "@/features/import/normalize/docx-zip";

/** Абзац docx: только текст и признаки для определения типа. Разметка не сохраняется. */
export type DocxParagraph = {
  index: number;
  text: string;
  /** Цепочка стилей абзаца: сам стиль и те, на которых он основан (id и названия). */
  styleIds: string[];
  styleNames: string[];
  /** Левый отступ в twips (1 см ≈ 567). Из абзаца, иначе из стиля. */
  indentLeft: number;
  align: "left" | "center" | "right" | "both";
  /** Весь текст абзаца жирный. */
  bold: boolean;
};

type StyleInfo = {
  id: string;
  name: string;
  basedOn: string | null;
  indentLeft: number | null;
  align: string | null;
  bold: boolean | null;
};

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1]! : null;
}

function readIndentLeft(pPr: string): number | null {
  const tag = pPr.match(/<w:ind\b[^>]*\/?>/)?.[0];
  if (!tag) return null;
  const value = attr(tag, "w:left") ?? attr(tag, "w:start");
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readAlign(pPr: string): string | null {
  const tag = pPr.match(/<w:jc\b[^>]*\/?>/)?.[0];
  return tag ? attr(tag, "w:val") : null;
}

/** `<w:b/>` или `<w:b w:val="1|true|on"/>` → true; `w:val="0|false|off"` → false; нет тега → null. */
function readBold(rPr: string): boolean | null {
  const tag = rPr.match(/<w:b(?:\s[^>]*)?\/>/)?.[0];
  if (!tag) return null;
  const value = attr(tag, "w:val");
  return value == null || !/^(0|false|off)$/i.test(value);
}

function parseStyles(stylesXml: string | null) {
  const styles = new Map<string, StyleInfo>();
  let defaultId: string | null = null;
  if (!stylesXml) return { styles, defaultId };
  for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const head = match[1]!;
    const body = match[2]!;
    if (attr(head, "w:type") !== "paragraph") continue;
    const id = attr(head, "w:styleId");
    if (!id) continue;
    if (/^(1|true|on)$/i.test(attr(head, "w:default") ?? "")) defaultId = id;
    const pPr = body.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? "";
    const rPr = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? "";
    const nameTag = body.match(/<w:name\b[^>]*\/>/)?.[0];
    const basedOnTag = body.match(/<w:basedOn\b[^>]*\/>/)?.[0];
    styles.set(id, {
      id,
      name: decodeXmlEntities((nameTag && attr(nameTag, "w:val")) ?? id),
      basedOn: basedOnTag ? attr(basedOnTag, "w:val") : null,
      indentLeft: readIndentLeft(pPr),
      align: readAlign(pPr),
      bold: readBold(rPr),
    });
  }
  return { styles, defaultId };
}

function styleChain(styles: Map<string, StyleInfo>, styleId: string | null) {
  const chain: StyleInfo[] = [];
  let current = styleId;
  while (current && chain.length < 10) {
    const style = styles.get(current);
    if (!style || chain.includes(style)) break;
    chain.push(style);
    current = style.basedOn;
  }
  return chain;
}

function normalizeAlign(value: string | null): DocxParagraph["align"] {
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "both";
  return "left";
}

function runText(run: string) {
  let text = "";
  for (const token of run.matchAll(
    /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>|<w:noBreakHyphen\s*\/>/g,
  )) {
    const tag = token[0];
    if (tag.startsWith("<w:tab")) text += "\t";
    else if (tag.startsWith("<w:br") || tag.startsWith("<w:cr")) text += "\n";
    else if (tag.startsWith("<w:noBreakHyphen")) text += "-";
    else text += decodeXmlEntities(token[1] ?? "");
  }
  return text;
}

export function parseDocxParagraphs(
  documentXml: string,
  stylesXml: string | null,
): DocxParagraph[] {
  const { styles, defaultId } = parseStyles(stylesXml);
  // Запасной вариант надписей (текстовых полей) дублирует их текст.
  const xml = documentXml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const result: DocxParagraph[] = [];

  for (const chunk of xml.split(/<\/w:p>/)) {
    const start = chunk.search(/<w:p[\s>]/);
    if (start < 0) continue;
    const paragraph = chunk.slice(start);

    const pPr = paragraph.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? "";
    const styleTag = pPr.match(/<w:pStyle\b[^>]*\/>/)?.[0];
    // Без pStyle у абзаца — стиль по умолчанию («Обычный»).
    const chain = styleChain(styles, styleTag ? attr(styleTag, "w:val") : defaultId);

    const ownIndent = readIndentLeft(pPr);
    const indentLeft =
      ownIndent ?? chain.find((style) => style.indentLeft != null)?.indentLeft ?? 0;
    const align = normalizeAlign(
      readAlign(pPr) ?? chain.find((style) => style.align != null)?.align ?? null,
    );
    const styleBold = chain.find((style) => style.bold != null)?.bold ?? false;

    let text = "";
    let textRuns = 0;
    let boldRuns = 0;
    for (const run of paragraph.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const body = run[1]!;
      const piece = runText(body);
      text += piece;
      if (!piece.trim()) continue;
      textRuns += 1;
      const rPr = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? "";
      if (readBold(rPr) ?? styleBold) boldRuns += 1;
    }

    result.push({
      index: result.length,
      text,
      styleIds: chain.map((style) => style.id),
      styleNames: chain.map((style) => style.name),
      indentLeft,
      align,
      bold: textRuns > 0 && boldRuns === textRuns,
    });
  }

  return result;
}

export function readDocxParagraphs(buffer: Buffer): DocxParagraph[] {
  const { documentXml, stylesXml } = readDocxParts(buffer);
  return parseDocxParagraphs(documentXml, stylesXml);
}
