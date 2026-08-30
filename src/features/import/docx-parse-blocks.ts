import type { ScriptBlockType } from "@prisma/client";

export type DocxParagraph = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  indentLeft: number;
  align: string;
};

function isSlugline(text: string) {
  return /^(?:\d+[\.\)]\s*)?(?:ИНТ|НАТ|INT|EXT)/iu.test(text.trim());
}

function isTransition(text: string) {
  return /^(?:ПЕРЕХОД|CUT TO|FADE (?:IN|OUT)|ЗАТЕМНЕНИЕ)/iu.test(text.trim());
}

function isCharacterLine(text: string) {
  const t = text.trim();
  return (
    t.length >= 2 &&
    t.length <= 40 &&
    t === t.toUpperCase() &&
    !isSlugline(t) &&
    !isTransition(t)
  );
}

function isParenthetical(text: string) {
  const t = text.trim();
  return t.startsWith("(") && t.endsWith(")");
}

export function classifyDocxParagraph(paragraph: DocxParagraph): ScriptBlockType {
  const text = paragraph.text.trim();
  if (!text) return "ACTION";

  if (isSlugline(text)) return "SLUGLINE";
  if (isTransition(text)) return "TRANSITION";
  if (paragraph.italic || isParenthetical(text)) return "PARENTHETICAL";
  if (isCharacterLine(text) && (paragraph.bold || paragraph.align === "center")) {
    return "CHARACTER";
  }
  if (paragraph.indentLeft > 900) return "DIALOGUE";
  if (text.startsWith("[[") && text.endsWith("]]")) return "BONEYARD";
  if (text.startsWith("*") && text.endsWith("*")) return "NOTE";

  return "ACTION";
}

export function parseDocxParagraphs(xml: string): DocxParagraph[] {
  const paragraphs = xml.split(/<\/w:p>/i);
  const result: DocxParagraph[] = [];

  for (const paragraph of paragraphs) {
    const text = [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)]
      .map((match) => match[1] ?? "")
      .join("");
    if (!text.trim()) continue;

    const bold = /<w:b\b/i.test(paragraph) && !/<w:b w:val="0"/i.test(paragraph);
    const italic = /<w:i\b/i.test(paragraph) && !/<w:i w:val="0"/i.test(paragraph);
    const underline =
      /<w:u\b/i.test(paragraph) && !/<w:u w:val="none"/i.test(paragraph);
    const indentMatch = paragraph.match(/<w:ind\b[^>]*w:left="(\d+)"/i);
    const alignMatch = paragraph.match(/<w:jc\b[^>]*w:val="([^"]+)"/i);

    result.push({
      text,
      bold,
      italic,
      underline,
      indentLeft: indentMatch ? Number(indentMatch[1]) : 0,
      align: alignMatch?.[1] ?? "left",
    });
  }

  return result;
}
