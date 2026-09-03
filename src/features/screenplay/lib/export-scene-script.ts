import type { ProjectType, ScriptBlockType } from "@prisma/client";
import {
  AlignmentType,
  Document,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  BorderStyle,
} from "docx";
import type { ExportColumn } from "@/features/exports/types";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import { NON_PRINTABLE_BLOCK_TYPES } from "@/features/screenplay/lib/block-types";
import { scriptContentToBlocks } from "@/features/screenplay/lib/block-serialization";
import {
  formatLocationCell,
  formatSceneNumber,
  getExtras,
  getGroup,
  type LibrettoScene,
} from "@/features/script/lib/libretto-display";
import { getLibrettoCellValue } from "@/features/script/lib/libretto-cell-values";
import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
} from "@/shared/i18n/domain-labels";

export type ScriptExportBlock = {
  type: ScriptBlockType;
  content: string;
  sceneId: string | null;
};

export type SceneScriptExportOptions = {
  showCharacters: boolean;
  showExtras: boolean;
  showGroup: boolean;
  showEpisodeNumber: boolean;
  showProjectHeader: boolean;
  /** full script body vs summary only (director) */
  contentMode: "full" | "summary";
  pdfPreset: "classic" | "crew";
  projectName: string;
  projectType: ProjectType;
  /** Director mode resource columns */
  directorColumns?: ExportColumn[];
  fieldLabels?: Record<string, string>;
};

const FONT = "Courier New";
const SIZE = 24;

function run(text: string, opts?: { bold?: boolean; italics?: boolean }) {
  return new TextRun({
    text,
    font: FONT,
    size: SIZE,
    bold: opts?.bold,
    italics: opts?.italics,
  });
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSceneHeading(
  scene: LibrettoScene,
  opts: Pick<SceneScriptExportOptions, "projectType" | "showEpisodeNumber">,
): string {
  const number = opts.showEpisodeNumber
    ? formatSceneNumber(scene, opts.projectType)
    : `${scene.number}${scene.postfix || ""}`;
  const intExt = scene.intExt
    ? intExtLabels[scene.intExt]
    : null;
  const location = formatLocationCell(scene);
  const place =
    intExt && location !== "—"
      ? `${intExt}. ${location}`
      : intExt || (location !== "—" ? location : null);
  const mode = scene.dayNight ? dayNightLabels[scene.dayNight] : null;
  const scriptDay =
    scene.scriptDay != null ? `сц. день ${scene.scriptDay}` : null;
  const chrono =
    scene.planSeconds != null && scene.planSeconds > 0
      ? formatSecondsMmSs(scene.planSeconds)
      : null;

  return [number, place, mode, scriptDay, chrono].filter(Boolean).join(" · ");
}

function castLine(scene: LibrettoScene, opts: SceneScriptExportOptions): string | null {
  const parts: string[] = [];
  if (opts.showCharacters) {
    const names = scene.characters.map((c) => c.character.name).join(", ");
    if (names) parts.push(names);
  }
  if (opts.showExtras) {
    const extras = getExtras(scene);
    if (extras && extras !== "—") parts.push(extras);
  }
  if (opts.showGroup) {
    const group = getGroup(scene);
    if (group && group !== "—") parts.push(group);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function blocksForScene(
  scene: LibrettoScene,
  allBlocks: ScriptExportBlock[],
): ScriptExportBlock[] {
  const fromVersion = allBlocks.filter((b) => b.sceneId === scene.id);
  if (fromVersion.length > 0) return fromVersion;
  return scriptContentToBlocks(scene.scriptContent, scene.id, 0).map((b) => ({
    type: b.type,
    content: b.content,
    sceneId: scene.id,
  }));
}

function printableBodyBlocks(blocks: ScriptExportBlock[]) {
  return blocks.filter(
    (b) =>
      !NON_PRINTABLE_BLOCK_TYPES.has(b.type) &&
      b.type !== "SLUGLINE" &&
      b.type !== "SCENE_CAST" &&
      b.content.trim(),
  );
}

function directorResourceCells(
  scene: LibrettoScene,
  columns: ExportColumn[],
  projectType: ProjectType,
  fieldLabels: Record<string, string>,
): { header: string; value: string }[] {
  return columns
    .filter((c) => c.fieldIds.length > 0)
    .map((col) => {
      const values = col.fieldIds
        .map((id) => getLibrettoCellValue(scene, id, projectType))
        .filter((v) => v && v !== "—");
      return {
        header: resolveColumnHeader(col) || fieldLabels[col.fieldIds[0]!] || col.title,
        value: values.join("; ") || "—",
      };
    });
}

function blockToDocxParagraph(block: ScriptExportBlock): Paragraph | null {
  const text = block.content.trim();
  if (!text) return null;
  if (NON_PRINTABLE_BLOCK_TYPES.has(block.type)) return null;
  if (block.type === "SLUGLINE" || block.type === "SCENE_CAST") return null;

  switch (block.type) {
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
    default:
      return new Paragraph({ children: [run(text)] });
  }
}

function thinBorder() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
  };
}

function buildSceneDocxChildren(
  scene: LibrettoScene,
  blocks: ScriptExportBlock[],
  opts: SceneScriptExportOptions,
  pageBreakBefore: boolean,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  out.push(
    new Paragraph({
      spacing: { before: pageBreakBefore ? 0 : 280, after: 80 },
      pageBreakBefore: pageBreakBefore || undefined,
      children: [run(buildSceneHeading(scene, opts), { bold: true })],
    }),
  );

  const cast = castLine(scene, opts);
  if (cast) {
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [run(cast, { italics: true })],
      }),
    );
  }

  if (opts.directorColumns && opts.directorColumns.length > 0) {
    const cells = directorResourceCells(
      scene,
      opts.directorColumns,
      opts.projectType,
      opts.fieldLabels ?? {},
    );
    if (cells.length > 0) {
      const width = Math.floor(9000 / cells.length);
      out.push(
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          rows: [
            new TableRow({
              children: cells.map(
                (c) =>
                  new TableCell({
                    borders: thinBorder(),
                    width: { size: width, type: WidthType.DXA },
                    children: [
                      new Paragraph({
                        children: [run(c.header, { bold: true })],
                      }),
                    ],
                  }),
              ),
            }),
            new TableRow({
              children: cells.map(
                (c) =>
                  new TableCell({
                    borders: thinBorder(),
                    width: { size: width, type: WidthType.DXA },
                    children: [
                      new Paragraph({ children: [run(c.value)] }),
                    ],
                  }),
              ),
            }),
          ],
        }),
      );
      out.push(new Paragraph({ children: [] }));
    }
  }

  if (opts.contentMode === "summary") {
    const summary = scene.summary?.trim();
    if (summary) {
      out.push(new Paragraph({ children: [run(summary)] }));
    }
    return out;
  }

  for (const block of printableBodyBlocks(blocks)) {
    const p = blockToDocxParagraph(block);
    if (p) out.push(p);
  }
  return out;
}

export async function buildSceneScriptDocx(
  scenes: LibrettoScene[],
  allBlocks: ScriptExportBlock[],
  opts: SceneScriptExportOptions,
) {
  const children: (Paragraph | Table)[] = [];
  scenes.forEach((scene, index) => {
    const blocks = blocksForScene(scene, allBlocks);
    const pageBreak =
      opts.pdfPreset === "crew" ? index > 0 : false;
    // For DOCX, crew mode = page break per scene
    children.push(
      ...buildSceneDocxChildren(scene, blocks, opts, pageBreak),
    );
  });

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
        headers: opts.showProjectHeader
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    children: [
                      run(opts.projectName, { italics: true }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function blockToHtml(block: ScriptExportBlock): string {
  const text = block.content.trim();
  if (!text) return "";
  const escaped = escapeHtml(text);
  const type = block.type.toLowerCase().replace(/_/g, "-");
  return `<p class="screenplay-block screenplay-block--${type}">${escaped}</p>`;
}

export function buildSceneScriptPrintHtml(
  scenes: LibrettoScene[],
  allBlocks: ScriptExportBlock[],
  opts: SceneScriptExportOptions,
) {
  const sections = scenes.map((scene, index) => {
    const blocks = blocksForScene(scene, allBlocks);
    const heading = escapeHtml(buildSceneHeading(scene, opts));
    const cast = castLine(scene, opts);
    const castHtml = cast
      ? `<p class="screenplay-cast">${escapeHtml(cast)}</p>`
      : "";

    let resourcesHtml = "";
    if (opts.directorColumns && opts.directorColumns.length > 0) {
      const cells = directorResourceCells(
        scene,
        opts.directorColumns,
        opts.projectType,
        opts.fieldLabels ?? {},
      );
      if (cells.length > 0) {
        resourcesHtml = `<table class="director-resources"><thead><tr>${cells
          .map((c) => `<th>${escapeHtml(c.header)}</th>`)
          .join("")}</tr></thead><tbody><tr>${cells
          .map((c) => `<td>${escapeHtml(c.value)}</td>`)
          .join("")}</tr></tbody></table>`;
      }
    }

    let bodyHtml = "";
    if (opts.contentMode === "summary") {
      const summary = scene.summary?.trim();
      bodyHtml = summary
        ? `<p class="screenplay-block">${escapeHtml(summary)}</p>`
        : "";
    } else {
      bodyHtml = printableBodyBlocks(blocks).map(blockToHtml).join("\n");
    }

    const pageClass =
      opts.pdfPreset === "crew" && index > 0 ? " scene-page-break" : "";
    return `<section class="scene-section${pageClass}"><h2 class="scene-heading">${heading}</h2>${castHtml}${resourcesHtml}${bodyHtml}</section>`;
  });

  const header = opts.showProjectHeader
    ? `<header class="project-header">${escapeHtml(opts.projectName)}</header>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.projectName)}</title>
  <style>
    @page { size: letter; margin: 1in 1in 1in 1.5in; }
    body { font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 1.35; color: #000; }
    .project-header { font-style: italic; margin-bottom: 1rem; border-bottom: 1px solid #ccc; padding-bottom: 0.35rem; }
    .scene-heading { font-size: 12pt; font-weight: bold; margin: 1.25rem 0 0.4rem; }
    .screenplay-cast { font-style: italic; color: #333; margin: 0 0 0.6rem; }
    .scene-page-break { page-break-before: always; }
    .director-resources { width: 100%; border-collapse: collapse; margin: 0.4rem 0 0.8rem; font-size: 10pt; }
    .director-resources th, .director-resources td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
    .director-resources th { background: #f0f0f0; text-align: left; }
    .screenplay-block--character { text-transform: uppercase; text-align: center; margin: 0.75rem 2.2in 0; }
    .screenplay-block--dialogue { margin: 0 1.5in 0 1in; }
    .screenplay-block--parenthetical { margin: 0 2in 0 1.6in; font-style: italic; }
    .screenplay-block--super { text-align: center; text-transform: uppercase; }
    .screenplay-block--transition { text-align: right; text-transform: uppercase; margin-top: 0.75rem; }
    @media print {
      .project-header { position: running(projectHeader); }
    }
  </style>
</head>
<body>${header}${sections.join("\n")}</body>
</html>`;
}
