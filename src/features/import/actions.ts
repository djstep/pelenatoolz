"use server";

import type { DayNight, IntExt } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { bootstrapScriptBlocks, applyImportScriptBlocks } from "@/features/screenplay/lib/sync";
import { createScriptVersion } from "@/features/screenplay/lib/versions";
import { buildSlugline } from "@/features/screenplay/lib/slugline";
import {
  buildImportBlocksFromDocx,
  buildImportBlocksFromSceneScripts,
  type ImportPreviewBlock,
} from "@/features/import/docx-blocks";
import { extractScriptText } from "@/features/import/extract-script";
import {
  parseScenesFromText,
  previewExtractedText,
} from "@/features/import/parse-script";
import { detectScriptFormat, formatLabel } from "@/features/import/script-formats";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listScenes } from "@/features/script/queries";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

import { mergeSceneEdits } from "@/features/import/merge-scene-edits";
import type {
  ImportActionState,
  ImportPreviewPayload,
  ImportPreviewScene,
} from "@/features/import/types";

export type {
  ImportActionState,
  ImportFieldKey,
  ImportPreviewPayload,
  ImportPreviewScene,
} from "@/features/import/types";

function formatSeconds(sec: number | null | undefined) {
  if (sec == null) return undefined;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function toDayNight(value?: string): DayNight | undefined {
  if (
    value === "DAY" ||
    value === "NIGHT" ||
    value === "DAWN" ||
    value === "DUSK"
  ) {
    return value;
  }
  return undefined;
}

function toIntExt(value?: string): IntExt | undefined {
  if (value === "INT" || value === "EXT" || value === "INT_EXT") {
    return value;
  }
  return undefined;
}

export async function previewScriptImportAction(
  projectId: string,
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Выберите файл сценария" };
  }

  const detected = detectScriptFormat(file.name);
  if (!detected) {
    return {
      error:
        "Формат не поддерживается. Загрузите .kitsp (КИТ Сценарист), .docx, .fdx, .fountain, .celtx или .txt",
    };
  }

  const timingMethod = String(formData.get("timingMethod") ?? "pages");
  const pageRatio = Number(formData.get("pageRatio") ?? 1) || 1;
  const showComparison = formData.get("showComparison") === "on";

  let text: string;
  let format = detected;
  try {
    const extracted = await extractScriptText(file);
    text = extracted.text;
    format = extracted.format;
  } catch {
    return {
      error: `Не удалось прочитать файл (${formatLabel(detected)}). Проверьте формат.`,
    };
  }

  if (!text) {
    return { error: "В файле нет текста" };
  }

  const parsed = parseScenesFromText(text, timingMethod, pageRatio);
  if (parsed.length === 0) {
    return {
      error: `Сцены не найдены (${formatLabel(format)}). Ожидается шапка: «1. ИНТ. ЛОКАЦИЯ – ДЕНЬ» или «INT. LOCATION - DAY». Из файла: ${previewExtractedText(text)}`,
    };
  }

  const existing = await listScenes(projectId);

  const scenes: ImportPreviewScene[] = parsed.map((p, idx) => {
    const match = existing.find(
      (s) =>
        s.number === p.number &&
        (s.postfix ?? "") === (p.postfix ?? "") &&
        (s.episodeNumber ?? 0) === (p.episodeNumber ?? 0),
    );
    const key = `${p.episodeNumber}-${p.number}-${p.postfix || ""}-${idx}`;
    const row: ImportPreviewScene = { ...p, key };
    if (match && showComparison) {
      row.existingId = match.id;
      row.old = {
        location: match.locations[0]?.location.name,
        intExt: match.intExt,
        characters: match.characters.map((c) => c.character.name),
        timing: formatSeconds(match.planSeconds),
        scriptDay: match.scriptDay,
        dayNight: match.dayNight,
        script: match.scriptContent,
      };
    }
    return row;
  });

  let importBlocks: ImportPreviewBlock[] = [];
  if (format === "docx") {
    const buffer = Buffer.from(await file.arrayBuffer());
    importBlocks = buildImportBlocksFromDocx(buffer);
  } else {
    importBlocks = buildImportBlocksFromSceneScripts(
      parsed.map((p) => ({
        script: p.script,
        characters: p.characters,
      })),
    );
  }

  const job = await prisma.scriptImportJob.create({
    data: {
      projectId,
      fileName: file.name,
      status: "preview",
      timingMethod,
      showComparison,
      previewData: {
        scenes,
        blocks: importBlocks,
      },
    },
  });

  return {
    preview: {
      jobId: job.id,
      fileName: file.name,
      scenes,
      blockCount: importBlocks.length,
    },
  };
}

export async function applyScriptImportAction(
  projectId: string,
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const jobId = String(formData.get("jobId") ?? "");
  const job = await prisma.scriptImportJob.findFirst({
    where: { id: jobId, projectId },
  });
  if (!job || !job.previewData) {
    return { error: "Сессия предпросмотра не найдена" };
  }

  const rawPreview = job.previewData as ImportPreviewPayload | ImportPreviewScene[];
  const scenes = Array.isArray(rawPreview) ? rawPreview : rawPreview.scenes;
  const importBlocks = Array.isArray(rawPreview) ? [] : (rawPreview.blocks ?? []);

  let applied = 0;
  const appliedScenes: ImportPreviewScene[] = [];
  const appliedSceneIds: Array<string | null> = [];

  for (const baseScene of scenes) {
    const scene = mergeSceneEdits(baseScene, formData);
    const selected = formData.get(`sel_${scene.key}`) === "on";
    if (!selected) continue;

    appliedScenes.push(scene);

    const existing = scene.existingId
      ? await prisma.scene.findFirst({
          where: { id: scene.existingId, projectId },
          select: { id: true },
        })
      : await prisma.scene.findFirst({
          where: {
            projectId,
            episodeNumber: scene.episodeNumber ?? 0,
            number: scene.number,
            postfix: scene.postfix ?? "",
          },
          select: { id: true },
        });

    appliedSceneIds.push(existing?.id ?? null);
    applied += 1;
  }

  const sourceType =
    job.fileName.toLowerCase().endsWith(".docx") ? "IMPORTED_DOCX" : "IMPORTED_OTHER";

  const versionTitle = String(formData.get("versionTitle") ?? "").trim();
  if (!versionTitle) {
    return { error: "Укажите название версии сценария" };
  }

  const version = await createScriptVersion({
    projectId,
    createdById: ctx.user.id!,
    sourceType,
    title: versionTitle,
    makeCurrent: true,
    blocks: [],
  });

  const indexMap = new Map<number, number>();
  let remappedIndex = 1;
  scenes.forEach((scene, index) => {
    if (formData.get(`sel_${scene.key}`) === "on") {
      indexMap.set(index + 1, remappedIndex++);
    }
  });

  const remappedBlocks = importBlocks
    .filter((block) => indexMap.has(block.sceneIndex))
    .map((block) => ({
      ...block,
      sceneIndex: indexMap.get(block.sceneIndex)!,
    }));

  const sluglines = appliedScenes.map((scene) =>
    buildSlugline({
      episodeNumber: scene.episodeNumber ?? 0,
      number: scene.number,
      postfix: scene.postfix ?? "",
      intExt: toIntExt(scene.intExt),
      dayNight: toDayNight(scene.dayNight),
      location: scene.location ?? "",
    }),
  );

  if (remappedBlocks.length > 0 && appliedScenes.length > 0) {
    await applyImportScriptBlocks(
      projectId,
      version.id,
      appliedSceneIds,
      remappedBlocks,
      sluglines,
    );
  } else {
    await bootstrapScriptBlocks(projectId, ctx.user.id!, version.id);
  }

  await prisma.scriptImportJob.update({
    where: { id: jobId },
    data: { status: "applied", scriptVersionId: version.id },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scriptImport,
    entityId: jobId,
    action: "CREATE",
    summary: `Импортирована версия сценария (${applied} сцен в тексте)`,
  });

  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/screenplay`);
  revalidatePath(`/ru/projects/${projectId}/screenplay/import`);

  return {
    success: `Создана версия сценария (${applied} сцен). Обновите либретто при необходимости.`,
    versionId: version.id,
  };
}
