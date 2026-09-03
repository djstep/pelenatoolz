import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditionDetailClient } from "@/features/auditions/components/audition-detail-client";
import { getAudition } from "@/features/auditions/queries";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; auditionId: string }>;
};

export default async function AuditionDetailPage({ params }: Props) {
  const { locale, projectId, auditionId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const audition = await getAudition(projectId, auditionId);
  if (!audition) notFound();

  const kindLabel =
    audition.kind === "solo"
      ? "Сольная"
      : audition.kind === "pair"
        ? "Парная"
        : "Ансамблевая";

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/preproduction/auditions`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← Все пробы
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold">
          Проба · {formatDateShort(audition.date)}
          {audition.time ? ` · ${audition.time}` : ""}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          {kindLabel}
          {audition.isSelfTape ? " · Самопроба" : ""}
          {audition.isFavorite ? " · ★" : ""}
        </p>
      </div>

      <Card>
        <div className="space-y-4 p-1">
          <ul className="space-y-1 text-sm">
            {audition.actors.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/${locale}/projects/${projectId}/preproduction/casting/${a.person.id}`}
                  className="hover:text-[var(--accent)]"
                >
                  {fullNameFromParts(a.person)}
                </Link>
                {a.character ? (
                  <span className="text-[var(--muted-fg)]">
                    {" "}
                    · {a.character.name}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {audition.comment ? (
            <p className="text-sm text-[var(--muted-fg)]">{audition.comment}</p>
          ) : null}
          <AuditionDetailClient
            projectId={projectId}
            canWrite={ctx.can("cast:write")}
            audition={{
              id: audition.id,
              date: audition.date.toISOString(),
              time: audition.time,
              isSelfTape: audition.isSelfTape,
              isFavorite: audition.isFavorite,
              comment: audition.comment,
              externalUrl: audition.externalUrl,
              kind: audition.kind,
              videoFile: audition.videoFile
                ? {
                    url: audition.videoFile.url,
                    originalName: audition.videoFile.originalName,
                    status: audition.videoFile.status,
                  }
                : null,
              scene: audition.scene,
              actors: audition.actors.map((a) => ({
                person: a.person,
                character: a.character,
              })),
            }}
          />
        </div>
      </Card>
    </div>
  );
}
