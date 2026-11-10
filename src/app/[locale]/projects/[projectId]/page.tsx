import Link from "next/link";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  filterNavGroups,
  navAccessFromContext,
  navHrefs,
  projectNavGroups,
} from "@/features/projects/lib/project-nav-groups";
import { getOverviewStats } from "@/features/projects/queries";
import { Card } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectOverviewPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  // Кнопки разделов и цифры — по тем же условиям, что и пункты меню.
  const nav = filterNavGroups(projectNavGroups, navAccessFromContext(ctx));
  const available = new Set(navHrefs(nav));
  const canOpen = (href: string) => available.has(href);
  const canOpenPost = nav.some((group) => group.id === "post");

  const show = {
    scenes: canOpen("/libretto"),
    locations: canOpen("/locations"),
    characters: canOpen("/characters"),
    schedule: canOpen("/schedule"),
  };
  const stats = await getOverviewStats(projectId, show);

  const showScriptCard = show.scenes || show.locations || show.characters;
  const showTeamCard = canOpen("/members");
  const showDayDocsCard =
    canOpen("/call-sheets") || canOpen("/reports") || canOpen("/smeta");
  const showFinanceCard = canOpen("/finance") || canOpenPost;
  const hasCards =
    showScriptCard || show.schedule || showTeamCard || showDayDocsCard || showFinanceCard;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[27px] font-bold leading-tight">Обзор проекта</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {[ctx.project.city, ctx.project.timezone, ctx.project.currency]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {canOpen("/settings") ? (
          <Link href={`/${locale}/projects/${projectId}/settings`}>
            <Button variant="secondary">Настройки проекта</Button>
          </Link>
        ) : null}
      </div>

      {hasCards ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {showScriptCard ? (
            <Card>
              <h3 className="font-display text-base font-bold">Сцены (либретто)</h3>
              <dl className="mt-3 space-y-1 text-sm">
                {stats.scenes !== null ? (
                  <div className="flex justify-between">
                    <dt className="text-[var(--muted-fg)]">Сцены</dt>
                    <dd className="font-medium">{stats.scenes}</dd>
                  </div>
                ) : null}
                {stats.locations !== null ? (
                  <div className="flex justify-between">
                    <dt className="text-[var(--muted-fg)]">Объекты</dt>
                    <dd className="font-medium">{stats.locations}</dd>
                  </div>
                ) : null}
                {stats.characters !== null ? (
                  <div className="flex justify-between">
                    <dt className="text-[var(--muted-fg)]">Персонажи</dt>
                    <dd className="font-medium">{stats.characters}</dd>
                  </div>
                ) : null}
              </dl>
              {canOpen("/libretto") ? (
                <div className="mt-4">
                  <Link href={`/${locale}/projects/${projectId}/libretto`}>
                    <Button variant="secondary">Открыть либретто</Button>
                  </Link>
                </div>
              ) : null}
            </Card>
          ) : null}

          {show.schedule ? (
            <Card>
              <h3 className="font-display text-base font-bold">КПП и вызывные</h3>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[var(--muted-fg)]">Съёмочные дни</dt>
                  <dd className="font-medium">{stats.days}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--muted-fg)]">Сцены в плане</dt>
                  <dd className="font-medium">
                    {stats.plannedScenes} / {stats.totalScenes}
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <Link href={`/${locale}/projects/${projectId}/schedule`}>
                  <Button variant="secondary">Открыть КПП</Button>
                </Link>
              </div>
            </Card>
          ) : null}

          {showTeamCard ? (
            <Card>
              <h3 className="font-display text-base font-bold">Команда</h3>
              <p className="mt-2 text-sm text-[var(--muted-fg)]">
                Приглашения, роли и доступ участников проекта.
              </p>
              <div className="mt-4">
                <Link href={`/${locale}/projects/${projectId}/members`}>
                  <Button variant="secondary">Участники</Button>
                </Link>
              </div>
            </Card>
          ) : null}

          {showDayDocsCard ? (
            <Card>
              <h3 className="font-display text-base font-bold">Вызывные и отчёты</h3>
              <p className="mt-2 text-sm text-[var(--muted-fg)]">
                Вызывной лист, производственный отчёт и занятость актёров по
                съёмочному дню.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {canOpen("/call-sheets") ? (
                  <Link href={`/${locale}/projects/${projectId}/call-sheets`}>
                    <Button variant="secondary">Вызывные</Button>
                  </Link>
                ) : null}
                {canOpen("/reports") ? (
                  <Link href={`/${locale}/projects/${projectId}/reports`}>
                    <Button variant="secondary">Отчёты</Button>
                  </Link>
                ) : null}
                {canOpen("/smeta") ? (
                  <Link href={`/${locale}/projects/${projectId}/smeta`}>
                    <Button variant="secondary">Смета</Button>
                  </Link>
                ) : null}
              </div>
            </Card>
          ) : null}

          {showFinanceCard ? (
            <Card>
              <h3 className="font-display text-base font-bold">Финансы и пост</h3>
              <p className="mt-2 text-sm text-[var(--muted-fg)]">
                Движение денег по проекту и пайплайн постпродакшна.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {canOpen("/finance") ? (
                  <Link href={`/${locale}/projects/${projectId}/finance`}>
                    <Button variant="secondary">Финансы</Button>
                  </Link>
                ) : null}
                {canOpenPost ? (
                  <Link href={`/${locale}/projects/${projectId}/post`}>
                    <Button variant="secondary">Постпродакшн</Button>
                  </Link>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-fg)]">Нет разделов, доступных вашей роли.</p>
      )}
    </div>
  );
}
