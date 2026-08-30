import { requireProjectContext } from "@/features/projects/lib/project-context";

import { formatLocationTitle } from "@/features/locations/lib/format-location";

import { LibrettoWorkspace } from "@/features/script/components/libretto-workspace";

import {

  listCharacters,

  listLocations,

  listScenes,

} from "@/features/script/queries";

import { Card } from "@/shared/ui/card";



type Props = {

  params: Promise<{ locale: string; projectId: string }>;

};



export default async function LibrettoPage({ params }: Props) {

  const { locale, projectId } = await params;

  const ctx = await requireProjectContext(projectId);



  if (!ctx.can("script:read")) {

    return <p className="text-sm text-[var(--danger)]">Нет доступа к сценам</p>;

  }



  const [scenes, locations, characters] = await Promise.all([

    listScenes(projectId),

    listLocations(projectId),

    listCharacters(projectId),

  ]);



  const locationOptions = locations.map((l) => ({

    id: l.id,

    name: formatLocationTitle(l.name, l.sublocation),

  }));



  const canWrite = ctx.can("script:write");



  return (

    <div className="space-y-6">

      <div>

        <h2 className="font-display text-2xl font-semibold">Сцены (либретто)</h2>

        <p className="mt-1 text-sm text-[var(--muted-fg)]">

          Разбивка сценария: локации, персонажи, хронометраж и статусы съёмки.

        </p>

      </div>



      <Card>

        <LibrettoWorkspace

          projectId={projectId}

          locale={locale}

          projectType={ctx.project.type}

          shootOnFilm={ctx.project.shootOnFilm ?? false}
          timingMode={ctx.project.timingMode}
          pageToMinuteRatio={Number(ctx.project.pageToMinuteRatio)}
          scenes={scenes}

          locations={locationOptions}

          characters={characters}

          canWrite={canWrite}

        />

      </Card>

    </div>

  );

}


