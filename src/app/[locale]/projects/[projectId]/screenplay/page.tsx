import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ScreenplayVersionsList } from "@/features/screenplay/components/screenplay-versions-list";
import { listScriptVersionsOverview } from "@/features/screenplay/lib/version-overview";
import {
  ensureCurrentScriptVersion,
  getProjectScreenplayMeta,
  listScriptVersions,
} from "@/features/screenplay/queries";
import { bootstrapScriptBlocks } from "@/features/screenplay/lib/sync";
import { listScenes } from "@/features/script/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ScreenplayPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сценарию</p>;
  }

  let versions = await listScriptVersions(projectId);

  if (versions.length === 0 && ctx.can("script:write")) {
    const version = await ensureCurrentScriptVersion(projectId, ctx.user.id!);
    await bootstrapScriptBlocks(projectId, ctx.user.id!, version.id);
    versions = await listScriptVersions(projectId);
  }

  const [meta, scenes] = await Promise.all([
    getProjectScreenplayMeta(projectId),
    listScenes(projectId),
  ]);

  const sceneTimings = scenes.map((scene) => ({
    sceneId: scene.id,
    planSeconds: scene.planSeconds,
  }));

  const versionsOverview = await listScriptVersionsOverview(
    projectId,
    meta.timingMode,
    Number(meta.pageToMinuteRatio),
    sceneTimings,
  );

  return (
    <ScreenplayVersionsList
      projectId={projectId}
      locale={locale}
      versions={versionsOverview}
      canWrite={ctx.can("script:write")}
    />
  );
}
