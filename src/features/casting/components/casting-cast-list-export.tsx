"use client";

import { useState, useTransition } from "react";
import { loadCastListExportBundleAction } from "@/features/casting/actions-cast-list-export";
import { CastListExportModal } from "@/features/casting/components/cast-list-export-modal";
import type { CastListExportBundleClient } from "@/features/casting/lib/cast-list-export-data";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

/**
 * Каст-лист со страницы кастинга. С фильтром по персонажу окно открывается сразу для него,
 * без фильтра — сначала выбор персонажа. Набор грузится при каждом открытии, окно живёт,
 * пока открыто, поэтому настройки одного персонажа не переходят к другому.
 */
export function CastingCastListExport({
  projectId,
  locale,
  characters,
  selectedCharacterId,
}: {
  projectId: string;
  locale: string;
  /** Персонажи с кандидатами — в порядке групп на странице. */
  characters: { id: string; name: string }[];
  /** Персонаж из фильтра; null — фильтра по персонажу нет. */
  selectedCharacterId: string | null;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [pickedId, setPickedId] = useState("");
  const [bundle, setBundle] = useState<CastListExportBundleClient | null>(null);

  const pickValue = characters.some((c) => c.id === pickedId)
    ? pickedId
    : (characters[0]?.id ?? "");

  function load(characterId: string) {
    start(async () => {
      const result = await loadCastListExportBundleAction(projectId, {
        characterId,
        locale,
      });
      if (!result.bundle) {
        toast.error(result.error ?? "Персонаж не найден");
        return;
      }
      setPicking(false);
      setBundle(result.bundle);
    });
  }

  function openExport() {
    if (selectedCharacterId) load(selectedCharacterId);
    else setPicking(true);
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={openExport}
      >
        {pending && !picking ? "…" : "Экспорт каст-листа"}
      </Button>
      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Каст-лист"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPicking(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={pending || !pickValue}
              onClick={() => load(pickValue)}
            >
              {pending ? "…" : "Далее"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="casting-cast-list-character">Персонаж</Label>
          <Select
            id="casting-cast-list-character"
            value={pickValue}
            onChange={(e) => setPickedId(e.target.value)}
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </Modal>
      {bundle ? (
        <CastListExportModal
          key={bundle.character.id}
          projectId={projectId}
          locale={locale}
          bundle={bundle}
          open
          onClose={() => setBundle(null)}
        />
      ) : null}
    </>
  );
}
