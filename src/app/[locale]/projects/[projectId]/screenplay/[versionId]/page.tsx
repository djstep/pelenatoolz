import { notFound } from "next/navigation";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ScreenplayWorkspace } from "@/features/screenplay/components/screenplay-workspace";
import {
  getProjectScreenplayMeta,
  getScriptVersion,
  listScriptCommentsForVersion,
  listVersionBlocks,
} from "@/features/screenplay/queries";
import { ScriptTitlePage } from "@/features/screenplay/components/script-title-page";
import {
  listCharacters,
  listLocations,
  listScenes,
} from "@/features/script/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string; versionId: string }>;
  searchParams: Promise<{ sceneId?: string }>;
};

export default async function ScreenplayVersionPage({ params, searchParams }: Props) {
  const { locale, projectId, versionId } = await params;
  const { sceneId } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сценарию</p>;
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) notFound();

  // Открытие версии ничего не пишет: пустая версия показывается пустой.
  const [blocks, characters, locations, meta, comments, scenes] = await Promise.all([
    listVersionBlocks(versionId),
    listCharacters(projectId),
    listLocations(projectId),
    getProjectScreenplayMeta(projectId),
    listScriptCommentsForVersion(versionId),
    listScenes(projectId),
  ]);

  const sceneTimings = scenes.map((scene) => ({
    sceneId: scene.id,
    planSeconds: scene.planSeconds,
    cut: scene.cutAt !== null,
  }));

  return (
    <>
      <ScriptTitlePage value={version.titlePage} />
      <ScreenplayWorkspace
        projectId={projectId}
        locale={locale}
        version={{
          id: version.id,
          versionNumber: version.versionNumber,
          title: version.title,
          note: version.note,
          isCurrent: version.isCurrent,
          isLocked: version.isLocked,
        }}
        blocks={blocks}
        comments={comments}
        characters={characters}
        locations={locations}
        timingMode={meta.timingMode}
        pageToMinuteRatio={Number(meta.pageToMinuteRatio)}
        sceneTimings={sceneTimings}
        scrollToSceneId={sceneId ?? null}
        canWrite={ctx.can("script:write") && !version.isLocked}
      />
    </>
  );
}
