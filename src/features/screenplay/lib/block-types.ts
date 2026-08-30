import type { ScriptBlockType } from "@prisma/client";

export type ScreenplayBlock = {
  id: string;
  type: ScriptBlockType;
  content: string;
  contentHtml?: string | null;
  sceneId: string | null;
  sortOrder: number;
};

export const SCRIPT_BLOCK_LABELS: Record<ScriptBlockType, string> = {
  SLUGLINE: "Время и место",
  SCENE_CAST: "Участники сцены",
  ACTION: "Описание действия",
  CHARACTER: "Герой",
  DIALOGUE: "Диалог",
  PARENTHETICAL: "Ремарка",
  SUPER: "Титр",
  TRANSITION: "Переход",
  NOTE: "Примечание",
  BONEYARD: "Непечатный текст",
  SCENE_GROUP: "Группа сцен",
  FOLDER: "Папка",
};

/** Block types omitted from print/export. */
export const NON_PRINTABLE_BLOCK_TYPES = new Set<ScriptBlockType>([
  "NOTE",
  "BONEYARD",
  "FOLDER",
]);

export const PRINTABLE_BLOCK_TYPES = (
  Object.keys(SCRIPT_BLOCK_LABELS) as ScriptBlockType[]
).filter((type) => !NON_PRINTABLE_BLOCK_TYPES.has(type));

export function nextBlockTypeOnEnter(
  current: ScriptBlockType,
): ScriptBlockType {
  switch (current) {
    case "SLUGLINE":
      return "ACTION";
    case "SCENE_CAST":
      return "ACTION";
    case "CHARACTER":
      return "DIALOGUE";
    case "DIALOGUE":
      return "CHARACTER";
    case "PARENTHETICAL":
      return "DIALOGUE";
    case "TRANSITION":
      return "SLUGLINE";
    case "SCENE_GROUP":
    case "FOLDER":
      return "SLUGLINE";
    case "SUPER":
      return "ACTION";
    case "NOTE":
    case "BONEYARD":
      return "ACTION";
    default:
      return "ACTION";
  }
}

export function blockTypeClassName(type: ScriptBlockType) {
  return `screenplay-block screenplay-block--${type.toLowerCase().replace(/_/g, "-")}`;
}

export function createEmptyBlock(
  type: ScriptBlockType,
  sortOrder: number,
  sceneId: string | null = null,
): ScreenplayBlock {
  return {
    id: `new-${crypto.randomUUID()}`,
    type,
    content: "",
    contentHtml: null,
    sceneId,
    sortOrder,
  };
}
