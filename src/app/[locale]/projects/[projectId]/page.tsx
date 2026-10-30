import Link from "next/link";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  filterNavGroups,
  navAccessFromContext,
  projectNavGroups,
} from "@/features/projects/lib/project-nav-groups";
import { getScheduleStats } from "@/features/schedule/queries";
import { getScriptStats } from "@/features/script/queries";
import { Card } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectOverviewPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  const [script, schedule] = await Promise.all([
    getScriptStats(projectId),
    getScheduleStats(projectId),
  ]);

  // Кнопки разделов — по тем же условиям, что и пункты меню.
  const nav = filterNavGroups(projectNavGroups, navAccessFromContext(ctx));
  const navHrefs = new Set(nav.flatMap((group) => group.items.map((item) => item.href)));
  const canOpen = (href: string) => navHrefs.has(href);
  const canOpenPost = nav.some((group) => group.id === "post");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">Обзор проекта</h2>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="font-display text-lg font-semibold">Сцены (либретто)</h3>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted-fg)]">Сцены</dt>
              <dd className="font-medium">{script.scenes}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted-fg)]">Локации</dt>
              <dd className="font-medium">{script.locations}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted-fg)]">Персонажи</dt>
              <dd className="font-medium">{script.characters}</dd>
            </div>
          </dl>
          {canOpen("/libretto") ? (
            <div className="mt-4">
              <Link href={`/${locale}/projects/${projectId}/libretto`}>
                <Button variant="secondary">Открыть либретто</Button>
              </Link>
            </div>
          ) : null}
        </Card>

        <Card>
          <h3 className="font-display text-lg font-semibold">КПП и вызывные</h3>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted-fg)]">Съёмочные дни</dt>
              <dd className="font-medium">{schedule.days}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted-fg)]">Сцены в плане</dt>
              <dd className="font-medium">
                {schedule.plannedScenes} / {schedule.totalScenes}
              </dd>
            </div>
          </dl>
          {canOpen("/schedule") ? (
            <div className="mt-4">
              <Link href={`/${locale}/projects/${projectId}/schedule`}>
                <Button variant="secondary">Открыть КПП</Button>
              </Link>
            </div>
          ) : null}
        </Card>

        <Card>
          <h3 className="font-display text-lg font-semibold">Команда</h3>
          <p className="mt-2 text-sm text-[var(--muted-fg)]">
            Приглашения, роли и доступ участников проекта.
          </p>
          {canOpen("/members") ? (
            <div className="mt-4">
              <Link href={`/${locale}/projects/${projectId}/members`}>
                <Button variant="secondary">Участники</Button>
              </Link>
            </div>
          ) : null}
        </Card>

        <Card>
          <h3 className="font-display text-lg font-semibold">Вызывные и отчёты</h3>
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

        <Card>
          <h3 className="font-display text-lg font-semibold">Финансы и пост</h3>
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
      </div>
    </div>
  );
}
