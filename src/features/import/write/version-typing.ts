import type { ScriptBlockType } from "@prisma/client";
import type { BlockTypingResult, ImportBlockType } from "@/features/import/normalize/block-types";

/** Типы блоков версии → типы нормализации. Титр — действие; служебные блоки не читаются. */
const VERSION_TYPES: Partial<Record<ScriptBlockType, ImportBlockType>> = {
  SLUGLINE: "SLUGLINE",
  SCENE_CAST: "SCENE_CAST",
  ACTION: "ACTION",
  CHARACTER: "CHARACTER",
  DIALOGUE: "DIALOGUE",
  PARENTHETICAL: "PARENTHETICAL",
  TRANSITION: "TRANSITION",
  NOTE: "NOTE",
  SUPER: "ACTION",
};

/**
 * Блоки версии сценария как вход нормализации (синхронизация с либретто). Тип блока — как в
 * версии, без угадывания, поэтому вопросов «тип абзаца» нет. `paragraphIndex` — индекс блока
 * в списке версии: по нему блок получает сцену при записи.
 */
export function typingFromVersionBlocks(
  blocks: readonly { type: ScriptBlockType; content: string }[],
): BlockTypingResult {
  const firstScene = blocks.findIndex((b) => b.type === "SLUGLINE");
  const typed = blocks.flatMap((block, paragraphIndex) => {
    const type = VERSION_TYPES[block.type];
    if (!type || !block.content.trim()) return [];
    return [
      {
        paragraphIndex,
        text: block.content,
        type,
        level: "style" as const,
        beforeFirstScene: firstScene < 0 || paragraphIndex < firstScene,
        autoNumber: null,
      },
    ];
  });
  return { blocks: typed, conflicts: [], dropped: [], indentProfile: null, notices: [] };
}
