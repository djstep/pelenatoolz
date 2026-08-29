"use client";

import { DayNight, SceneKind, SceneStatus } from "@prisma/client";
import {
  emptyFilters,
  type LibrettoFilters,
  type TextMatchMode,
} from "@/features/script/lib/libretto-filters";
import {
  dayNightLabels,
  locationKindLabels,
  sceneKindLabels,
  sceneStatusLabels,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";

function MatchModeRadios({
  name,
  value,
  modes,
}: {
  name: string;
  value: TextMatchMode;
  modes: TextMatchMode[];
}) {
  const labels: Record<TextMatchMode, string> = {
    one_of: "Один из",
    exclude: "Исключить",
    all: "Все",
    exact: "Точное",
  };
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {modes.map((m) => (
        <label key={m} className="flex items-center gap-1">
          <input type="radio" name={name} value={m} defaultChecked={value === m} />
          {labels[m]}
        </label>
      ))}
    </div>
  );
}

export function LibrettoFiltersModal({
  open,
  onClose,
  filters,
  onApply,
  shootingUnits,
}: {
  open: boolean;
  onClose: () => void;
  filters: LibrettoFilters;
  onApply: (f: LibrettoFilters) => void;
  shootingUnits: string[];
}) {
  return (
    <Modal open={open} onClose={onClose} title="Фильтры сцен" wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const statuses = fd.getAll("status") as SceneStatus[];
          const kinds = fd.getAll("sceneKind") as SceneKind[];
          const units = fd.getAll("shootingUnit") as string[];
          const kindsLoc = fd.getAll("locationKind") as string[];
          onApply({
            search: String(fd.get("search") ?? filters.search),
            shootDateFrom: String(fd.get("shootDateFrom") ?? ""),
            shootDateTo: String(fd.get("shootDateTo") ?? ""),
            episodeFrom: String(fd.get("episodeFrom") ?? ""),
            episodeTo: String(fd.get("episodeTo") ?? ""),
            sceneFrom: String(fd.get("sceneFrom") ?? ""),
            sceneTo: String(fd.get("sceneTo") ?? ""),
            dayNight: String(fd.get("dayNight") ?? ""),
            scriptDay: String(fd.get("scriptDay") ?? ""),
            statuses,
            sceneKinds: kinds,
            shootingUnits: units,
            locationKinds: kindsLoc,
            locationQuery: String(fd.get("locationQuery") ?? ""),
            locationMode: (fd.get("locationMode") as TextMatchMode) ?? "one_of",
            placeQuery: String(fd.get("placeQuery") ?? ""),
            placeMode: (fd.get("placeMode") as TextMatchMode) ?? "one_of",
            characterQuery: String(fd.get("characterQuery") ?? ""),
            characterMode: (fd.get("characterMode") as TextMatchMode) ?? "one_of",
            actorQuery: String(fd.get("actorQuery") ?? ""),
            actorMode: (fd.get("actorMode") as TextMatchMode) ?? "one_of",
            resourceQuery: String(fd.get("resourceQuery") ?? ""),
          });
          onClose();
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Планируемая дата съёмки — с</Label>
            <Input name="shootDateFrom" type="date" defaultValue={filters.shootDateFrom} />
          </div>
          <div>
            <Label>по</Label>
            <Input name="shootDateTo" type="date" defaultValue={filters.shootDateTo} />
          </div>
          <div>
            <Label>Серии — с / по</Label>
            <div className="flex gap-2">
              <Input name="episodeFrom" defaultValue={filters.episodeFrom} />
              <Input name="episodeTo" defaultValue={filters.episodeTo} />
            </div>
          </div>
          <div>
            <Label>Сцены — с / по</Label>
            <div className="flex gap-2">
              <Input name="sceneFrom" defaultValue={filters.sceneFrom} />
              <Input name="sceneTo" defaultValue={filters.sceneTo} />
            </div>
          </div>
          <div>
            <Label>Режим дня</Label>
            <Select name="dayNight" defaultValue={filters.dayNight}>
              <option value="">Все</option>
              {Object.entries(dayNightLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Номер сценарного дня</Label>
            <Input name="scriptDay" defaultValue={filters.scriptDay} />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Статус сцены</Label>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(sceneStatusLabels) as SceneStatus[]).map((s) => (
              <label key={s} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="status" value={s} defaultChecked={filters.statuses.includes(s)} />
                {sceneStatusLabels[s]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Тип</Label>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(sceneKindLabels) as SceneKind[]).map((k) => (
              <label key={k} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="sceneKind" value={k} defaultChecked={filters.sceneKinds.includes(k)} />
                {sceneKindLabels[k]}
              </label>
            ))}
          </div>
        </div>

        {shootingUnits.length > 0 ? (
          <div>
            <Label className="mb-2 block">Съёмочная группа</Label>
            <div className="flex flex-wrap gap-3">
              {shootingUnits.map((u) => (
                <label key={u} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="shootingUnit" value={u} defaultChecked={filters.shootingUnits.includes(u)} />
                  {u}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <Label className="mb-2 block">Тип локации</Label>
          <div className="flex flex-wrap gap-3">
            {Object.entries(locationKindLabels).map(([k, v]) => (
              <label key={k} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="locationKind" value={k} defaultChecked={filters.locationKinds.includes(k)} />
                {v}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <Label>Локация</Label>
          <Input name="locationQuery" defaultValue={filters.locationQuery} />
          <MatchModeRadios name="locationMode" value={filters.locationMode} modes={["one_of", "exclude"]} />
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <Label>Место (адрес)</Label>
          <Input name="placeQuery" defaultValue={filters.placeQuery} />
          <MatchModeRadios name="placeMode" value={filters.placeMode} modes={["one_of", "exclude"]} />
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <Label>Персонажи</Label>
          <Input name="characterQuery" defaultValue={filters.characterQuery} />
          <MatchModeRadios name="characterMode" value={filters.characterMode} modes={["all", "one_of", "exclude", "exact"]} />
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <Label>Актёры</Label>
          <Input name="actorQuery" defaultValue={filters.actorQuery} />
          <MatchModeRadios name="actorMode" value={filters.actorMode} modes={["all", "one_of", "exclude", "exact"]} />
        </div>

        <details className="rounded-xl border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-sm font-medium">Ресурсы</summary>
          <div className="mt-2">
            <Input name="resourceQuery" placeholder="Реквизит, массовка, каскадёр…" defaultValue={filters.resourceQuery} />
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Применить</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
          <Button type="button" variant="ghost" onClick={() => onApply(emptyFilters())}>
            Сбросить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
