import type { ScriptBlockType } from "@prisma/client";
import {
  classifyDocxParagraph,
  parseDocxParagraphs,
} from "@/features/import/docx-parse-blocks";
import { readZipEntry } from "@/features/import/extract-script";

export type ImportPreviewBlock = {
  type: ScriptBlockType;
  content: string;
  sceneIndex: number;
  sortOrder: number;
};

function refineBlockType(
  type: ScriptBlockType,
  text: string,
  previous: ScriptBlockType | null,
): ScriptBlockType {
  if (
    previous === "CHARACTER" &&
    type === "ACTION" &&
    !text.startsWith("(")
  ) {
    return "DIALOGUE";
  }
  if (type === "ACTION" && previous === "DIALOGUE") {
    const t = text.trim();
    if (
      t.length >= 2 &&
      t.length <= 40 &&
      t === t.toUpperCase() &&
      !/^(?:ИНТ|НАТ|INT|EXT)/iu.test(t)
    ) {
      return "CHARACTER";
    }
  }
  return type;
}

export function buildImportBlocksFromDocx(
  buffer: Buffer,
): ImportPreviewBlock[] {
  const xml = readZipEntry(buffer, "word/document.xml");
  if (!xml) return [];

  const paragraphs = parseDocxParagraphs(xml);
  const blocks: ImportPreviewBlock[] = [];
  let sceneIndex = 0;
  let previous: ScriptBlockType | null = null;

  for (const paragraph of paragraphs) {
    const rawType = classifyDocxParagraph(paragraph);
    const type = refineBlockType(rawType, paragraph.text, previous);
    if (type === "SLUGLINE") sceneIndex += 1;

    blocks.push({
      type,
      content: paragraph.text.trim(),
      sceneIndex: Math.max(sceneIndex, 1),
      sortOrder: blocks.length,
    });
    previous = type;
  }

  return blocks;
}

export function buildImportBlocksFromSceneScripts(
  scenes: Array<{ script?: string; characters: string[] }>,
): ImportPreviewBlock[] {
  const blocks: ImportPreviewBlock[] = [];
  let order = 0;

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]!;
    let previous: ScriptBlockType | null = null;
    if (scene.characters.length > 0) {
      blocks.push({
        type: "SCENE_CAST",
        content: scene.characters.join(", "),
        sceneIndex: sceneIndex + 1,
        sortOrder: order++,
      });
      previous = "SCENE_CAST";
    }

    const script = scene.script?.trim();
    if (!script) continue;

    for (const line of script.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let type: ScriptBlockType = "ACTION";
      if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
        type = "PARENTHETICAL";
      } else if (
        previous !== "CHARACTER" &&
        /^(?:ПЕРЕХОД|CUT TO|FADE|ЗАТЕМНЕНИЕ)/iu.test(trimmed)
      ) {
        type = "TRANSITION";
      } else if (
        (previous === null ||
          previous === "ACTION" ||
          previous === "DIALOGUE" ||
          previous === "SCENE_CAST") &&
        trimmed.length <= 40 &&
        trimmed === trimmed.toUpperCase() &&
        !/^(?:ИНТ|НАТ|INT|EXT)/iu.test(trimmed)
      ) {
        type = "CHARACTER";
      } else if (previous === "CHARACTER" || previous === "PARENTHETICAL") {
        type = "DIALOGUE";
      }

      blocks.push({
        type,
        content: trimmed,
        sceneIndex: sceneIndex + 1,
        sortOrder: order++,
      });
      previous = type;
    }
  }

  return blocks;
}
