"use server";

import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  buildSceneScriptDocx,
  buildSceneScriptPrintHtml,
  type SceneScriptExportOptions,
} from "@/features/screenplay/lib/export-scene-script";
import { getCurrentScriptVersion } from "@/features/screenplay/lib/versions";
import { listScenes } from "@/features/script/queries";
import { prisma } from "@/shared/db/prisma";

export type ActorScriptExportFormat = "docx" | "pdf";
export type ActorScriptGrouping = "script_order" | "shoot_date";

export type SingleActorScriptPayload = {
  /** characterId whose scenes we want */
  characterId: string;
  format: ActorScriptExportFormat;
  grouping: ActorScriptGrouping;
  /** optional: only include these episode numbers (1-based) */
  episodeRange?: { from?: number; to?: number };
  /** optional: only include scenes on days within this date range (ISO strings) */
  dateRange?: { from?: string; to?: string };
};

export type MultiActorScriptPayload = {
  characterIds: string[];
  format: ActorScriptExportFormat;
  grouping: ActorScriptGrouping;
};

export type ActorScriptResult =
  | { type: "single"; base64: string; fileName: string; mime: string }
  | { type: "single_html"; html: string; fileName: string }
  | { type: "zip"; base64: string; fileName: string }
  | { error: string };

function actorFileName(
  characterName: string,
  format: ActorScriptExportFormat,
  versionTag: string,
): string {
  const safe = characterName.replace(/[<>:"/\\|?*]/g, "_").slice(0, 40);
  return format === "docx"
    ? `${safe}-${versionTag}.docx`
    : `${safe}-${versionTag}.html`;
}

async function buildDocxBuffer(
  projectId: string,
  projectName: string,
  projectType: import("@prisma/client").ProjectType,
  orderedSceneIds: string[],
  allScenes: Awaited<ReturnType<typeof listScenes>>,
  blocks: { type: import("@prisma/client").ScriptBlockType; content: string; sceneId: string | null }[],
): Promise<Buffer | null> {
  const idSet = new Set(orderedSceneIds);
  const scenes = allScenes.filter((s) => idSet.has(s.id));
  const order = new Map(orderedSceneIds.map((id, i) => [id, i]));
  scenes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (scenes.length === 0) return null;

  const opts: SceneScriptExportOptions = {
    showCharacters: true,
    showExtras: false,
    showGroup: false,
    showEpisodeNumber: true,
    showProjectHeader: true,
    contentMode: "full",
    pdfPreset: "classic",
    projectName,
    projectType,
  };

  const buf = await buildSceneScriptDocx(scenes, blocks, opts);
  return Buffer.from(buf);
}

function buildHtmlString(
  projectName: string,
  projectType: import("@prisma/client").ProjectType,
  orderedSceneIds: string[],
  allScenes: Awaited<ReturnType<typeof listScenes>>,
  blocks: { type: import("@prisma/client").ScriptBlockType; content: string; sceneId: string | null }[],
): string {
  const idSet = new Set(orderedSceneIds);
  const scenes = allScenes.filter((s) => idSet.has(s.id));
  const order = new Map(orderedSceneIds.map((id, i) => [id, i]));
  scenes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const opts: SceneScriptExportOptions = {
    showCharacters: true,
    showExtras: false,
    showGroup: false,
    showEpisodeNumber: true,
    showProjectHeader: true,
    contentMode: "full",
    pdfPreset: "classic",
    projectName,
    projectType,
  };
  return buildSceneScriptPrintHtml(scenes, blocks, opts);
}

function orderSceneIdsForCharacter(
  scenes: Awaited<ReturnType<typeof listScenes>>,
  characterId: string,
  grouping: ActorScriptGrouping,
): string[] {
  const matching = scenes.filter((s) =>
    s.characters.some((c) => c.character.id === characterId),
  );

  if (grouping === "shoot_date") {
    type SortableScene = { id: string; date: Date; dayNumber: number; scriptOrder: number };
    const withDates: SortableScene[] = matching.flatMap((scene) => {
      if (scene.shootDayScenes.length === 0) return [];
      const sorted = [...scene.shootDayScenes].sort(
        (a, b) => a.shootDay.dayNumber - b.shootDay.dayNumber,
      );
      return sorted.map((sds) => ({
        id: scene.id,
        date: sds.shootDay.date,
        dayNumber: sds.shootDay.dayNumber,
        scriptOrder: (scene as { sortOrder?: number }).sortOrder ?? 0,
      }));
    });
    withDates.sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.scriptOrder - b.scriptOrder,
    );
    const seen = new Set<string>();
    return withDates.map((s) => s.id).filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // script_order: keep natural scene order
  return matching.map((s) => s.id);
}

export async function exportCharacterScriptAction(
  projectId: string,
  payload: SingleActorScriptPayload,
): Promise<ActorScriptResult> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) return { error: "Недостаточно прав" };

  const [allScenes, currentVersion, project] = await Promise.all([
    listScenes(projectId),
    getCurrentScriptVersion(projectId),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, type: true, fullName: true },
    }),
  ]);

  const character = await prisma.character.findFirst({
    where: { id: payload.characterId, projectId },
    select: { id: true, name: true },
  });
  if (!character) return { error: "Персонаж не найден" };

  let sceneIds = orderSceneIdsForCharacter(
    allScenes,
    payload.characterId,
    payload.grouping,
  );

  // Episode filter
  if (payload.episodeRange?.from != null || payload.episodeRange?.to != null) {
    const from = payload.episodeRange.from ?? 0;
    const to = payload.episodeRange.to ?? Infinity;
    const idSet = new Set(sceneIds);
    sceneIds = allScenes
      .filter(
        (s) =>
          idSet.has(s.id) &&
          s.episodeNumber >= from &&
          s.episodeNumber <= to,
      )
      .map((s) => s.id);
  }

  // Date range filter (КПП)
  if (payload.dateRange?.from != null || payload.dateRange?.to != null) {
    const from = payload.dateRange.from
      ? new Date(payload.dateRange.from)
      : null;
    const to = payload.dateRange.to ? new Date(payload.dateRange.to) : null;
    const idSet = new Set(sceneIds);
    sceneIds = allScenes
      .filter((s) => {
        if (!idSet.has(s.id)) return false;
        if (s.shootDayScenes.length === 0) return false;
        return s.shootDayScenes.some((sds) => {
          const d = sds.shootDay.date;
          return (
            (from == null || d >= from) &&
            (to == null || d <= to)
          );
        });
      })
      .map((s) => s.id);
  }

  if (sceneIds.length === 0) {
    return { error: "Нет сцен по заданным фильтрам" };
  }

  const allIds = new Set(sceneIds);
  const blocks = currentVersion
    ? await prisma.scriptBlock.findMany({
        where: {
          projectId,
          scriptVersionId: currentVersion.id,
          OR: [
            { sceneId: { in: [...allIds] } },
            { sceneId: null },
          ],
        },
        orderBy: { sortOrder: "asc" },
        select: { type: true, content: true, sceneId: true },
      })
    : [];

  const projectName = project?.fullName || project?.name || "Сценарий";
  const projectType = project?.type ?? "FEATURE";
  const versionTag = currentVersion
    ? `v${currentVersion.versionNumber}`
    : "draft";
  const fileName = actorFileName(character.name, payload.format, versionTag);

  if (payload.format === "docx") {
    const buf = await buildDocxBuffer(
      projectId,
      projectName,
      projectType,
      sceneIds,
      allScenes,
      blocks,
    );
    if (!buf) return { error: "Нет сцен для экспорта" };
    return {
      type: "single",
      base64: buf.toString("base64"),
      fileName,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  const html = buildHtmlString(projectName, projectType, sceneIds, allScenes, blocks);
  return { type: "single_html", html, fileName };
}

export async function exportMultiCharacterScriptsAction(
  projectId: string,
  payload: MultiActorScriptPayload,
): Promise<ActorScriptResult> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) return { error: "Недостаточно прав" };

  if (payload.characterIds.length === 0)
    return { error: "Выберите хотя бы одного персонажа" };

  const [allScenes, currentVersion, project, characters] = await Promise.all([
    listScenes(projectId),
    getCurrentScriptVersion(projectId),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, type: true, fullName: true },
    }),
    prisma.character.findMany({
      where: { id: { in: payload.characterIds }, projectId },
      select: { id: true, name: true },
    }),
  ]);

  const charMap = new Map(characters.map((c) => [c.id, c]));
  const allNeededIds = new Set<string>();
  const perChar = new Map<string, string[]>();

  for (const charId of payload.characterIds) {
    const ids = orderSceneIdsForCharacter(allScenes, charId, payload.grouping);
    perChar.set(charId, ids);
    ids.forEach((id) => allNeededIds.add(id));
  }

  const blocks = currentVersion
    ? await prisma.scriptBlock.findMany({
        where: {
          projectId,
          scriptVersionId: currentVersion.id,
          OR: [
            { sceneId: { in: [...allNeededIds] } },
            { sceneId: null },
          ],
        },
        orderBy: { sortOrder: "asc" },
        select: { type: true, content: true, sceneId: true },
      })
    : [];

  const projectName = project?.fullName || project?.name || "Сценарий";
  const projectType = project?.type ?? "FEATURE";
  const versionTag = currentVersion
    ? `v${currentVersion.versionNumber}`
    : "draft";

  // jszip is a transitive dep (exceljs pulls it in)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const charId of payload.characterIds) {
    const char = charMap.get(charId);
    if (!char) continue;
    const sceneIds = perChar.get(charId) ?? [];
    if (sceneIds.length === 0) continue;

    const fileName = actorFileName(char.name, payload.format, versionTag);
    if (payload.format === "docx") {
      const buf = await buildDocxBuffer(
        projectId,
        projectName,
        projectType,
        sceneIds,
        allScenes,
        blocks,
      );
      if (buf) zip.file(fileName, buf);
    } else {
      const html = buildHtmlString(projectName, projectType, sceneIds, allScenes, blocks);
      zip.file(fileName, html);
    }
  }

  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  const dayTag = new Date().toISOString().slice(0, 10);
  return {
    type: "zip",
    base64: zipBuf.toString("base64"),
    fileName: `scripts-${dayTag}.zip`,
  };
}
