"use client";

import { useActionState, useEffect, useState } from "react";
import { LocationKind } from "@prisma/client";
import {
  createLocationAction,
  updateLocationAction,
  type LocationActionState,
} from "@/features/locations/actions";
import type { LocationEditSource } from "@/features/locations/queries";
import { locationKindLabels } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";

const initial: LocationActionState = {};

type AddressOption = { id: string; name: string };

export function LocationModal({
  projectId,
  open,
  onClose,
  location,
  addresses,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  location?: LocationEditSource | null;
  addresses: string[];
}) {
  const isEdit = Boolean(location);
  const bound = location
    ? updateLocationAction.bind(null, projectId, location.id)
    : createLocationAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  const [address, setAddress] = useState(location?.address ?? "");
  const [addressOptions] = useState<AddressOption[]>(() =>
    addresses.map((a) => ({ id: a, name: a })),
  );

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  useEffect(() => {
    if (open) setAddress(location?.address ?? "");
  }, [open, location]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование локации" : "Добавление локации"}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="location-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          {!isEdit ? (
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" name="createAnother" form="location-form" />
              Создать ещё
            </label>
          ) : null}
          {state.error ? (
            <span className="w-full text-sm text-[var(--danger)]">{state.error}</span>
          ) : null}
        </div>
      }
    >
      <form id="location-form" action={action} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="loc-name">Название локации *</Label>
            <Input
              id="loc-name"
              name="name"
              required
              defaultValue={location?.name ?? ""}
              placeholder="Госпиталь"
            />
          </div>
          <div>
            <Label htmlFor="loc-sublocation">Подлокация</Label>
            <Input
              id="loc-sublocation"
              name="sublocation"
              defaultValue={location?.sublocation ?? ""}
              placeholder="Кабинет"
            />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Тип *</Label>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(locationKindLabels) as LocationKind[]).map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="locationKind"
                  value={kind}
                  defaultChecked={location?.locationKind === kind}
                  required={!location?.locationKind}
                />
                {locationKindLabels[kind]}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="hasDecoration"
            defaultChecked={location?.hasDecoration ?? false}
          />
          Декорация на площадке
        </label>

        <div>
          <Label htmlFor="loc-notes">Описание / комментарии</Label>
          <textarea
            id="loc-notes"
            name="notes"
            rows={3}
            className="glass-input w-full resize-y px-3 py-2 text-sm"
            defaultValue={location?.notes ?? ""}
          />
        </div>

        <div>
          <Label htmlFor="loc-address">Адрес</Label>
          <div className="flex gap-2">
            <Input
              id="loc-address"
              name="address"
              list="address-book"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Тверская, 4"
            />
          </div>
          <datalist id="address-book">
            {addressOptions.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
        </div>

        <div>
          <Label htmlFor="loc-tags">Теги</Label>
          <Input
            id="loc-tags"
            name="tags"
            defaultValue={location?.tags ?? ""}
            placeholder="через запятую"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
          <input type="checkbox" name="applyAddressToSiblings" />
          Установить адрес для всех подлокаций с тем же названием локации
        </label>
      </form>
    </Modal>
  );
}
