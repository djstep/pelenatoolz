"use client";

import { useActionState, useState } from "react";
import {
  addLocationPhotoAction,
  deleteLocationPhotoAction,
  type LocationActionState,
} from "@/features/locations/actions";
import { LocationModal } from "@/features/locations/components/location-modal";
import {
  formatLocationKind,
  formatLocationTitle,
  parseTags,
} from "@/features/locations/lib/format-location";
import type { LocationDetail } from "@/features/locations/queries";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Card } from "@/shared/ui/card";

const initial: LocationActionState = {};

export function LocationDetailView({
  locale,
  projectId,
  location,
  addresses,
  canWrite,
}: {
  locale: string;
  projectId: string;
  location: LocationDetail;
  addresses: string[];
  canWrite: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const boundPhoto = addLocationPhotoAction.bind(null, projectId, location.id);
  const [photoState, photoAction, photoPending] = useActionState(boundPhoto, initial);

  const sceneCount = location.scenes.length;
  const shiftIds = new Set<string>();
  let totalSeconds = 0;
  for (const link of location.scenes) {
    if (link.scene.planSeconds) totalSeconds += link.scene.planSeconds;
    for (const d of link.scene.shootDayScenes) {
      shiftIds.add(d.shootDay.id);
    }
  }

  const mapSrc = location.address
    ? `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(location.address)}&z=16`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <a href={`/${locale}/projects/${projectId}/locations`} className="hover:text-white">
              ← Все локации
            </a>
          </p>
          <h2 className="font-display text-2xl font-semibold">
            {formatLocationTitle(location.name, location.sublocation)}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {formatLocationKind(location.locationKind)}
            {location.address ? ` · ${location.address}` : ""}
          </p>
        </div>
        {canWrite ? (
          <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
            Редактировать
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-[var(--muted-fg)]">Сцен</p>
          <p className="text-2xl font-semibold">{sceneCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--muted-fg)]">Смен по КПП</p>
          <p className="text-2xl font-semibold">{shiftIds.size}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--muted-fg)]">Хронометраж (план)</p>
          <p className="text-2xl font-semibold">{formatSecondsMmSs(totalSeconds)}</p>
        </Card>
      </div>

      {location.notes ? (
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Описание</h3>
          <p className="whitespace-pre-wrap text-sm text-[var(--muted-fg)]">{location.notes}</p>
        </Card>
      ) : null}

      {parseTags(location.tags).length > 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Теги: {parseTags(location.tags).join(", ")}
        </p>
      ) : null}

      {mapSrc ? (
        <Card className="overflow-hidden p-0">
          <iframe
            title="Карта"
            src={mapSrc}
            className="h-[360px] w-full border-0"
            loading="lazy"
          />
        </Card>
      ) : (
        <p className="text-sm text-[var(--muted-fg)]">Укажите адрес — появится карта Яндекса.</p>
      )}

      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Галерея</h3>
        {location.photos.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {location.photos.map((photo) => (
              <div key={photo.id} className="relative overflow-hidden rounded-xl border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.caption ?? ""} className="aspect-video w-full object-cover" />
                {canWrite ? (
                  <form
                    className="absolute right-2 top-2"
                    action={async () => {
                      await deleteLocationPhotoAction(projectId, location.id, photo.id);
                    }}
                  >
                    <Button type="submit" variant="danger" className="px-2 py-1 text-xs">×</Button>
                  </form>
                ) : null}
                {photo.caption ? (
                  <p className="p-2 text-xs text-[var(--muted-fg)]">{photo.caption}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-fg)]">Фото пока нет.</p>
        )}
        {canWrite ? (
          <form action={photoAction} className="mt-4 flex flex-wrap gap-2">
            <Input name="url" placeholder="URL изображения" className="min-w-[16rem] flex-1" required />
            <Input name="caption" placeholder="Подпись" className="max-w-[12rem]" />
            <Button type="submit" variant="secondary" disabled={photoPending}>
              {photoPending ? "…" : "Добавить фото"}
            </Button>
            {photoState.error ? (
              <span className="w-full text-sm text-[var(--danger)]">{photoState.error}</span>
            ) : null}
          </form>
        ) : null}
      </Card>

      <LocationModal
        projectId={projectId}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        location={location}
        addresses={addresses}
      />
    </div>
  );
}
