import { notFound } from "next/navigation";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { formatLocationTitle } from "@/features/locations/lib/format-location";
import { listResourceCategoriesForScenes } from "@/features/resources/queries";
import { SceneEditor } from "@/features/script/components/scene-editor";
import {
  getSceneForEdit,
  getSceneNeighbors,
  listCharacters,
  listLocations,
} from "@/features/script/queries";
import { serializeForClient } from "@/shared/db/serialize-decimal";

type Props = {
  params: Promise<{ locale: string; projectId: string; sceneId: string }>;
};

export default async function ScenePage({ params }: Props) {
  const { locale, projectId, sceneId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сценам</p>;
  }

  const [scene, neighbors, locations, characters, resourceCategories] =
    await Promise.all([
      getSceneForEdit(projectId, sceneId),
      getSceneNeighbors(projectId, sceneId),
      listLocations(projectId),
      listCharacters(projectId),
      listResourceCategoriesForScenes(projectId),
    ]);

  if (!scene) notFound();

  const locationOptions = locations.map((l) => ({
    id: l.id,
    name: formatLocationTitle(l.name, l.sublocation),
  }));

  return (
    <SceneEditor
      projectId={projectId}
      locale={locale}
      projectType={ctx.project.type}
      shootOnFilm={ctx.project.shootOnFilm ?? false}
      scene={serializeForClient(scene)}
      prev={neighbors.prev}
      next={neighbors.next}
      locations={locationOptions}
      characters={characters.map((c) => ({ id: c.id, name: c.name }))}
      resourceCategories={resourceCategories.map((c) => ({
        id: c.id,
        name: c.name,
        countable: c.countable,
        items: c.items,
      }))}
      canWrite={ctx.can("script:write")}
    />
  );
}
