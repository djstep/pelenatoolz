"use client";

import type { TimingMode } from "@prisma/client";
import { useCallback, useState } from "react";
import { quickCreateLocationAction } from "@/features/locations/actions";
import { ScreenplayBlockEditor } from "@/features/screenplay/components/screenplay-block-editor";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { quickCreateCharacterAction } from "@/features/script/actions";
import { Modal } from "@/shared/ui/modal";

type Option = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  versionId: string;
  sceneId: string;
  sceneLabel: string;
  blocks: ScreenplayBlock[];
  characters: Option[];
  locations: Option[];
  timingMode: TimingMode;
  pageToMinuteRatio: number;
  canWrite: boolean;
};

export function SceneScriptEditorModal({
  open,
  onClose,
  projectId,
  versionId,
  sceneId,
  sceneLabel,
  blocks,
  characters: initialCharacters,
  locations: initialLocations,
  timingMode,
  pageToMinuteRatio,
  canWrite,
}: Props) {
  const [characters, setCharacters] = useState(initialCharacters);
  const [locations, setLocations] = useState(initialLocations);

  const handleCreateCharacter = useCallback(
    async (name: string) => {
      const result = await quickCreateCharacterAction(projectId, name);
      if ("error" in result) return null;
      const option = { id: result.id, name: result.name };
      setCharacters((prev) =>
        prev.some((item) => item.id === option.id) ? prev : [...prev, option],
      );
      return option;
    },
    [projectId],
  );

  const handleCreateLocation = useCallback(
    async (name: string) => {
      const result = await quickCreateLocationAction(projectId, name);
      if ("error" in result) return null;
      const option = { id: result.id, name: result.name };
      setLocations((prev) =>
        prev.some((item) => item.id === option.id) ? prev : [...prev, option],
      );
      return option;
    },
    [projectId],
  );

  return (
    <Modal open={open} onClose={onClose} title={`Текст сцены ${sceneLabel}`} wide>
      <ScreenplayBlockEditor
        projectId={projectId}
        versionId={versionId}
        initialBlocks={blocks}
        characters={characters}
        locations={locations}
        timingMode={timingMode}
        pageToMinuteRatio={pageToMinuteRatio}
        sceneId={sceneId}
        canWrite={canWrite}
        compact
        onCreateCharacter={canWrite ? handleCreateCharacter : undefined}
        onCreateLocation={canWrite ? handleCreateLocation : undefined}
      />
    </Modal>
  );
}
