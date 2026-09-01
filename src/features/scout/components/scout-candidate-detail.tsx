"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { ScoutCandidateStatus } from "@prisma/client";
import Link from "next/link";
import {
  deleteScoutCandidateAction,
  updateScoutCandidateAction,
  updateScoutCandidateStatusAction,
  type ScoutActionState,
} from "@/features/scout/actions";
import {
  formatScoutLocations,
  ScoutFormFields,
} from "@/features/scout/components/scout-form-fields";
import type { ScoutCandidateDetail } from "@/features/scout/queries";
import { scoutStatusOptions } from "@/features/preproduction/lib/status-labels";
import { StatusSelect } from "@/features/preproduction/components/status-select";
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";

const initial: ScoutActionState = {};

type LocationOpt = { id: string; name: string; sublocation: string | null };

function mediaUrls(value: unknown): { url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { url: string } =>
      Boolean(item && typeof item === "object" && "url" in item),
  );
}

export function ScoutCandidateDetail({
  projectId,
  locale,
  candidate,
  locations,
  canWrite,
}: {
  projectId: string;
  locale: string;
  candidate: ScoutCandidateDetail;
  locations: LocationOpt[];
  canWrite: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const isEditable = canWrite && candidate.status !== "APPROVED";

  const bound = updateScoutCandidateAction.bind(null, projectId, candidate.id);
  const [state, action, formPending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) setEditOpen(false);
  }, [state.success]);

  const locationLinks = formatScoutLocations(candidate.locationLinks, locale, projectId);
  const photos = mediaUrls(candidate.photos);
  const videos = mediaUrls(candidate.videos);

  function runStatus(status: ScoutCandidateStatus) {
    startTransition(async () => {
      const result = await updateScoutCandidateStatusAction(
        projectId,
        candidate.id,
        status,
      );
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/preproduction/scout`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← Скаут
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">{candidate.title}</h1>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {candidate.address ?? "Адрес не указан"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusSelect
              value={candidate.status}
              options={scoutStatusOptions}
              disabled={!isEditable || pending}
              onChange={
                isEditable
                  ? (next) => runStatus(next as ScoutCandidateStatus)
                  : undefined
              }
            />
            {isEditable ? (
              <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
                Редактировать
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-medium text-[var(--muted-fg)]">Игровые объекты</h2>
            <ul className="mt-2 space-y-1">
              {locationLinks.map((loc) => (
                <li key={loc.id}>
                  <Link href={loc.href} className="text-sm hover:text-[var(--accent)]">
                    {loc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <span className="text-[var(--muted-fg)]">Стоимость</span>
              <p className="font-medium">{candidate.cost ?? "—"}</p>
            </div>
            <div>
              <span className="text-[var(--muted-fg)]">Контакт</span>
              <p className="font-medium">
                {candidate.contactName ?? "—"}
                {candidate.contactPhone ? ` · ${candidate.contactPhone}` : ""}
              </p>
            </div>
          </div>
          {candidate.notes ? (
            <div>
              <h2 className="text-sm font-medium text-[var(--muted-fg)]">Заметки</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm">{candidate.notes}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          {photos.length > 0 ? (
            <div>
              <h2 className="mb-2 text-sm font-medium text-[var(--muted-fg)]">Фото</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((photo, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${photo.url}-${i}`}
                    src={photo.url}
                    alt=""
                    className="aspect-video w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            </div>
          ) : null}
          {videos.length > 0 ? (
            <div>
              <h2 className="mb-2 text-sm font-medium text-[var(--muted-fg)]">Видео</h2>
              <ul className="space-y-1 text-sm">
                {videos.map((video, i) => (
                  <li key={`${video.url}-${i}`}>
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      {video.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {canWrite && candidate.status !== "APPROVED" ? (
        <form
          action={async () => {
            if (!confirm(`Удалить «${candidate.title}»?`)) return;
            const r = await deleteScoutCandidateAction(projectId, candidate.id);
            if (r.error) toast.error(r.error);
            if (r.success) toast.success(r.success);
          }}
        >
          <Button type="submit" variant="danger">
            Удалить кандидата
          </Button>
        </form>
      ) : null}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Редактирование кандидата"
        wide
        footer={
          <div className="flex gap-3">
            <Button type="submit" form="scout-edit-form" disabled={formPending}>
              {formPending ? "…" : "Сохранить"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
          </div>
        }
      >
        <form id="scout-edit-form" action={action} key={candidate.updatedAt.toISOString()}>
          <ScoutFormFields candidate={candidate} locations={locations} />
        </form>
      </Modal>
    </div>
  );
}
