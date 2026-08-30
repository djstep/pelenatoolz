import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";
import type { ScriptBlockType } from "@prisma/client";
import { NON_PRINTABLE_BLOCK_TYPES } from "@/features/screenplay/lib/block-types";

type ExportBlock = {
  type: ScriptBlockType;
  content: string;
};

const FONT = "Courier New";
const SIZE = 24; // 12pt

function run(text: string, opts?: { bold?: boolean; italics?: boolean }) {
  return new TextRun({
    text,
    font: FONT,
    size: SIZE,
    bold: opts?.bold,
    italics: opts?.italics,
  });
}

function blockToParagraph(block: ExportBlock): Paragraph | null {
  const text = block.content.trim();
  if (!text) return null;
  if (NON_PRINTABLE_BLOCK_TYPES.has(block.type)) return null;

  switch (block.type) {
    case "SLUGLINE":
      return new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [run(text.toUpperCase(), { bold: true })],
      });
    case "SCENE_CAST":
      return new Paragraph({
        spacing: { after: 120 },
        children: [run(text, { italics: true })],
      });
    case "CHARACTER":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: convertInchesToTwip(2.2), right: convertInchesToTwip(2.2) },
        spacing: { before: 120 },
        children: [run(text.toUpperCase())],
      });
    case "DIALOGUE":
      return new Paragraph({
        indent: { left: convertInchesToTwip(1), right: convertInchesToTwip(1.5) },
        children: [run(text)],
      });
    case "PARENTHETICAL":
      return new Paragraph({
        indent: { left: convertInchesToTwip(1.6), right: convertInchesToTwip(2) },
        children: [run(`(${text.replace(/^\(|\)$/g, "")})`, { italics: true })],
      });
    case "SUPER":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run(text.toUpperCase())],
      });
    case "TRANSITION":
      return new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 120 },
        children: [run(text.toUpperCase())],
      });
    case "SCENE_GROUP":
      return new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [run(text.toUpperCase(), { bold: true })],
      });
    default:
      return new Paragraph({ children: [run(text)] });
  }
}

export async function buildScreenplayDocx(blocks: ExportBlock[]) {
  const paragraphs = blocks
    .map(blockToParagraph)
    .filter((p): p is Paragraph => p != null);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.5),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function buildScreenplayPrintHtml(
  blocks: ExportBlock[],
  title: string,
) {
  const body = blocks
    .filter((block) => !NON_PRINTABLE_BLOCK_TYPES.has(block.type))
    .map((block) => {
      const text = block.content.trim();
      if (!text) return "";
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const type = block.type.toLowerCase().replace(/_/g, "-");
      return `<p class="screenplay-block screenplay-block--${type}">${escaped}</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: letter; margin: 1in 1in 1in 1.5in; }
    body { font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 1.35; color: #000; }
    .screenplay-block--slugline { text-transform: uppercase; font-weight: bold; margin-top: 1.25rem; }
    .screenplay-block--character { text-transform: uppercase; text-align: center; margin: 0.75rem 2.2in 0; }
    .screenplay-block--dialogue { margin: 0 1.5in 0 1in; }
    .screenplay-block--parenthetical { margin: 0 2in 0 1.6in; font-style: italic; }
    .screenplay-block--super { text-align: center; text-transform: uppercase; }
    .screenplay-block--transition { text-align: right; text-transform: uppercase; margin-top: 0.75rem; }
    .screenplay-block--scene-cast { font-style: italic; color: #444; }
    .screenplay-block--scene-group { font-weight: bold; text-transform: uppercase; margin-top: 1rem; }
  </style>
</head>
<body>${body}</body>
</html>`;
}
