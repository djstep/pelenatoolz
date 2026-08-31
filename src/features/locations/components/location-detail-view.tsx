"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  addLocationPhotoAction,
  deleteLocationPhotoAction,
  updateLocationRequirementsAction,
  updateLocationScoutSnapshotAction,
  type LocationActionState,
} from "@/features/locations/actions";
import { LocationModal } from "@/features/locations/components/location-modal";
import {
  formatLocationKind,
  formatLocationTitle,
  parseTags,
} from "@/features/locations/lib/format-location";
import type { LocationDetail } from "@/features/locations/queries";
import { scoutStatusLabels } from "@/features/preproduction/lib/status-labels";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";
import { useActionToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
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

  const reqBound = updateLocationRequirementsAction.bind(null, projectId, location.id);
  const [reqState, reqAction, reqPending] = useActionState(reqBound, initial);
  useActionToast(reqState);

  const snapBound = updateLocationScoutSnapshotAction.bind(null, projectId, location.id);
  const [snapState, snapAction, snapPending] = useActionState(snapBound, initial);
  useActionToast(snapState);

  const scoutSnapshot = location.scoutSnapshot;

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

      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Требования по сценарию</h3>
          <Link
            href={`/${locale}/projects/${projectId}/preproduction/scout`}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Открыть скаут →
          </Link>
        </div>
        <form action={reqAction} className="space-y-3">
          <div>
            <Label htmlFor="requirementNotes">Что нужно найти</Label>
            <textarea
              id="requirementNotes"
              name="requirementNotes"
              rows={2}
              className="glass-input w-full resize-y px-3 py-2 text-sm"
              placeholder="Тип площадки, декорация, особенности…"
              defaultValue={location.requirementNotes ?? ""}
              disabled={!canWrite}
            />
          </div>
          {canWrite ? (
            <Button type="submit" variant="secondary" disabled={reqPending}>
              {reqPending ? "…" : "Сохранить требования"}
            </Button>
          ) : null}
        </form>
      </Card>

      {location.scoutCandidates.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Кандидаты скаута</h3>
          <ul className="space-y-2 text-sm">
            {location.scoutCandidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <span>{c.title}</span>
                <span className="rounded-full bg-[var(--glass-badge-bg)] px-2 py-0.5 text-xs">
                  {scoutStatusLabels[c.status]}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {scoutSnapshot ? (
        <Card className="space-y-4 p-4">
          <h3 className="font-semibold">Утверждённая площадка (снимок)</h3>
          <p className="text-xs text-[var(--muted-fg)]">
            Скопировано при утверждении. Изменения здесь не затрагивают карточку в Скауте.
          </p>
          <form action={snapAction} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="snapAddress">Адрес</Label>
              <Input
                id="snapAddress"
                name="address"
                defaultValue={scoutSnapshot.address ?? ""}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="snapCost">Стоимость</Label>
              <Input
                id="snapCost"
                name="cost"
                type="number"
                min={0}
                defaultValue={scoutSnapshot.cost ?? undefined}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="snapContactName">Контакт</Label>
              <Input
                id="snapContactName"
                name="contactName"
                defaultValue={scoutSnapshot.contactName ?? ""}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="snapContactPhone">Телефон</Label>
              <Input
                id="snapContactPhone"
                name="contactPhone"
                defaultValue={scoutSnapshot.contactPhone ?? ""}
                disabled={!canWrite}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="snapNotes">Заметки</Label>
              <textarea
                id="snapNotes"
                name="notes"
                rows={2}
                className="glass-input w-full resize-y px-3 py-2 text-sm"
                defaultValue={scoutSnapshot.notes ?? ""}
                disabled={!canWrite}
              />
            </div>
            {canWrite ? (
              <div className="md:col-span-2">
                <Button type="submit" disabled={snapPending}>
                  {snapPending ? "…" : "Сохранить снимок"}
                </Button>
              </div>
            ) : null}
          </form>
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
