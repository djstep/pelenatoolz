"use client";

import { LocationKind, SceneStatus } from "@prisma/client";
import {
  emptyLocationFilters,
  type LocationFilters,
} from "@/features/locations/lib/location-filters";
import {
  locationKindLabels,
  sceneStatusLabels,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

export function LocationsFiltersModal({
  open,
  onClose,
  filters,
  onApply,
  addresses,
}: {
  open: boolean;
  onClose: () => void;
  filters: LocationFilters;
  onApply: (f: LocationFilters) => void;
  addresses: string[];
}) {
  return (
    <Modal open={open} onClose={onClose} title="Фильтры локаций" wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const decoration = fd.get("hasDecoration");
          onApply({
            addresses: fd.getAll("address") as string[],
            kinds: fd.getAll("kind") as LocationKind[],
            hasDecoration:
              decoration === "yes" ? true : decoration === "no" ? false : null,
            episodeFrom: String(fd.get("episodeFrom") ?? ""),
            episodeTo: String(fd.get("episodeTo") ?? ""),
            sceneStatuses: fd.getAll("sceneStatus") as SceneStatus[],
            sceneCountFrom: String(fd.get("sceneCountFrom") ?? ""),
            sceneCountTo: String(fd.get("sceneCountTo") ?? ""),
            estimatedShiftFrom: String(fd.get("estimatedShiftFrom") ?? ""),
            estimatedShiftTo: String(fd.get("estimatedShiftTo") ?? ""),
            kppShiftFrom: String(fd.get("kppShiftFrom") ?? ""),
            kppShiftTo: String(fd.get("kppShiftTo") ?? ""),
            kppDateFrom: String(fd.get("kppDateFrom") ?? ""),
            kppDateTo: String(fd.get("kppDateTo") ?? ""),
          });
          onClose();
        }}
      >
        <div>
          <Label>Адрес</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {addresses.length === 0 ? (
              <p className="text-sm text-[var(--muted-fg)]">Адресов пока нет</p>
            ) : (
              addresses.map((addr) => (
                <label key={addr} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="address"
                    value={addr}
                    defaultChecked={filters.addresses.includes(addr)}
                  />
                  {addr}
                </label>
              ))
            )}
          </div>
        </div>

        <div>
          <Label>Тип</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {(Object.keys(locationKindLabels) as LocationKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="kind"
                  value={k}
                  defaultChecked={filters.kinds.includes(k)}
                />
                {locationKindLabels[k]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label>Декорация</Label>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasDecoration"
                value="any"
                defaultChecked={filters.hasDecoration == null}
              />
              Любая
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasDecoration"
                value="yes"
                defaultChecked={filters.hasDecoration === true}
              />
              Есть
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasDecoration"
                value="no"
                defaultChecked={filters.hasDecoration === false}
              />
              Нет
            </label>
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

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Смен (расчётных)</Label>
            <div className="mt-1 flex gap-2">
              <Input
                name="estimatedShiftFrom"
                type="number"
                defaultValue={filters.estimatedShiftFrom}
              />
              <Input
                name="estimatedShiftTo"
                type="number"
                defaultValue={filters.estimatedShiftTo}
              />
            </div>
          </div>
          <div>
            <Label>Смен в КПП</Label>
            <div className="mt-1 flex gap-2">
              <Input name="kppShiftFrom" type="number" defaultValue={filters.kppShiftFrom} />
              <Input name="kppShiftTo" type="number" defaultValue={filters.kppShiftTo} />
            </div>
          </div>
        </div>

        <div>
          <Label>Хотя бы одна смена в КПП в период</Label>
          <div className="mt-1 flex gap-2">
            <Input name="kppDateFrom" type="date" defaultValue={filters.kppDateFrom} />
            <Input name="kppDateTo" type="date" defaultValue={filters.kppDateTo} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
          <Button type="submit">Применить</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onApply(emptyLocationFilters())}
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
