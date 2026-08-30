import type { ScriptBlockType } from "@prisma/client";
import { SCRIPT_BLOCK_LABELS } from "@/features/screenplay/lib/block-types";

export type FormatPreset = {
  id: string;
  label: string;
  type: ScriptBlockType;
};

/** Paragraph style presets — map to screenplay block types. */
export const FORMAT_PRESETS: FormatPreset[] = [
  { id: "action", label: "Описание действия", type: "ACTION" },
  { id: "character", label: "Герой", type: "CHARACTER" },
  { id: "dialogue", label: "Диалог", type: "DIALOGUE" },
  { id: "parenthetical", label: "Ремарка", type: "PARENTHETICAL" },
  { id: "slugline", label: "Время и место", type: "SLUGLINE" },
  { id: "scene-cast", label: "Участники сцены", type: "SCENE_CAST" },
  { id: "transition", label: "Переход", type: "TRANSITION" },
  { id: "super", label: "Титр", type: "SUPER" },
  { id: "note", label: "Примечание", type: "NOTE" },
];

export function presetLabel(type: ScriptBlockType) {
  return SCRIPT_BLOCK_LABELS[type];
}
