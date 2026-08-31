"use client";

import { SceneStatus } from "@prisma/client";
import {
  emptyCharacterFilters,
  type CastFilterStatus,
  type CharacterFilters,
} from "@/features/characters/lib/character-filters";
import { sceneStatusLabels } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

const CAST_STATUS_LABELS: Record<CastFilterStatus, string> = {
  APPROVED: "Утверждён",
  OPEN: "Без каста",
  HAS_CANDIDATES: "Есть кандидаты",
};

export function CharactersFiltersModal({
  open,
  onClose,
  filters,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: CharacterFilters;
  onApply: (f: CharacterFilters) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Фильтры персонажей" wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const roleReq = fd.get("hasRoleRequirements");
          const desc = fd.get("hasDescription");
          onApply({
            castStatuses: fd.getAll("castStatus") as CastFilterStatus[],
            episodeFrom: String(fd.get("episodeFrom") ?? ""),
            episodeTo: String(fd.get("episodeTo") ?? ""),
            sceneStatuses: fd.getAll("sceneStatus") as SceneStatus[],
            sceneCountFrom: String(fd.get("sceneCountFrom") ?? ""),
            sceneCountTo: String(fd.get("sceneCountTo") ?? ""),
            planMinutesFrom: String(fd.get("planMinutesFrom") ?? ""),
            planMinutesTo: String(fd.get("planMinutesTo") ?? ""),
            hasRoleRequirements:
              roleReq === "yes" ? true : roleReq === "no" ? false : null,
            hasDescription: desc === "yes" ? true : desc === "no" ? false : null,
          });
          onClose();
        }}
      >
        <div>
          <Label>Каст</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {(Object.keys(CAST_STATUS_LABELS) as CastFilterStatus[]).map((st) => (
              <label key={st} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="castStatus"
                  value={st}
                  defaultChecked={filters.castStatuses.includes(st)}
                />
                {CAST_STATUS_LABELS[st]}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Требования к роли</Label>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hasRoleRequirements"
                  value="any"
                  defaultChecked={filters.hasRoleRequirements == null}
                />
                Любые
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hasRoleRequirements"
                  value="yes"
                  defaultChecked={filters.hasRoleRequirements === true}
                />
                Указаны
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hasRoleRequirements"
                  value="no"
                  defaultChecked={filters.hasRoleRequirements === false}
                />
                Нет
              </label>
            </div>
          </div>
          <div>
            <Label>Описание</Label>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hasDescription"
                  value="any"
                  defaultChecked={filters.hasDescription == null}
                />
                Любое
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hasDescription"
                  value="yes"
                  defaultChecked={filters.hasDescription === true}
                />
                Есть
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="hasDescription"
                  value="no"
                  defaultChecked={filters.hasDescription === false}
                />
                Нет
              </label>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Серии (от — до)</Label>
            <div className="mt-1 flex gap-2">
              <Input name="episodeFrom" type="number" defaultValue={filters.episodeFrom} />
              <Input name="episodeTo" type="number" defaultValue={filters.episodeTo} />
            </div>
          </div>
          <div>
            <Label>Количество сцен</Label>
            <div className="mt-1 flex gap-2">
              <Input name="sceneCountFrom" type="number" defaultValue={filters.sceneCountFrom} />
              <Input name="sceneCountTo" type="number" defaultValue={filters.sceneCountTo} />
            </div>
          </div>
        </div>

        <div>
          <Label>Статус привязанных сцен</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {(Object.keys(sceneStatusLabels) as SceneStatus[]).map((st) => (
              <label key={st} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="sceneStatus"
                  value={st}
                  defaultChecked={filters.sceneStatuses.includes(st)}
                />
                {sceneStatusLabels[st]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label>Хронометраж план (минуты)</Label>
          <div className="mt-1 flex gap-2">
            <Input
              name="planMinutesFrom"
              type="number"
              min={0}
              defaultValue={filters.planMinutesFrom}
            />
            <Input
              name="planMinutesTo"
              type="number"
              min={0}
              defaultValue={filters.planMinutesTo}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
          <Button type="submit">Применить</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onApply(emptyCharacterFilters())}
          >
            Сбросить
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </Modal>
  );
}
