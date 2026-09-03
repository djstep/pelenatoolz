"use client";

import { auditionKindLabels, type AuditionKind } from "@/features/auditions/lib/types";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";

type Person = {
  id: string;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
};

type Character = { id: string; name: string } | null;

type Scene = {
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
} | null;

export type AuditionPlayerData = {
  id: string;
  date: string | Date;
  time: string | null;
  isSelfTape: boolean;
  comment: string | null;
  externalUrl: string | null;
  kind: AuditionKind;
  videoFile: { url: string | null; originalName: string; status: string } | null;
  scene: Scene;
  actors: { person: Person; character: Character }[];
};

function sceneLabel(scene: NonNullable<Scene>) {
  const num = scene.postfix ? `${scene.number}${scene.postfix}` : scene.number;
  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}.` : "";
  return `${ep}${num}${scene.title ? ` — ${scene.title}` : ""}`;
}

function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function AuditionPlayerModal({
  audition,
  onClose,
}: {
  audition: AuditionPlayerData | null;
  onClose: () => void;
}) {
  if (!audition) return null;

  const videoUrl = audition.videoFile?.url ?? null;
  const yt = audition.externalUrl ? youtubeEmbed(audition.externalUrl) : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Проба · ${formatDateShort(audition.date)}${audition.time ? ` ${audition.time}` : ""}`}
      wide
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="aspect-video overflow-hidden rounded-xl bg-black">
          {videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              className="h-full w-full"
              preload="metadata"
            />
          ) : yt ? (
            <iframe
              title="Проба"
              src={yt}
              className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : audition.externalUrl ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">
              <a
                href={audition.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Открыть внешнее видео
              </a>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-white/60">
              Видео недоступно
              {audition.videoFile?.status === "PROCESSING"
                ? " (ещё обрабатывается)"
                : ""}
            </div>
          )}
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-[var(--muted-fg)]">Тип: </span>
            {auditionKindLabels[audition.kind]}
            {audition.isSelfTape ? " · Самопроба" : ""}
          </p>
          <p>
            <span className="text-[var(--muted-fg)]">Сцена: </span>
            {audition.scene ? sceneLabel(audition.scene) : "—"}
          </p>
          <p className="sm:col-span-2">
            <span className="text-[var(--muted-fg)]">Участники: </span>
            {audition.actors
              .map((a) => {
                const name = fullNameFromParts(a.person);
                return a.character ? `${name} (${a.character.name})` : name;
              })
              .join(", ")}
          </p>
          {audition.comment ? (
            <p className="sm:col-span-2 whitespace-pre-wrap">
              <span className="text-[var(--muted-fg)]">Комментарий: </span>
              {audition.comment}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

export function AuditionThumb({
  onClick,
  label,
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
      aria-label={label ?? "Смотреть пробу"}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white transition group-hover:bg-[var(--accent)]">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M5 3.5v9l8-4.5-8-4.5z" />
        </svg>
      </span>
    </button>
  );
}
