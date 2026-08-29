"use server";

import type { DayNight, IntExt } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { extractScriptText } from "@/features/import/extract-script";
import {
  parseScenesFromText,
  previewExtractedText,
} from "@/features/import/parse-script";
import { detectScriptFormat, formatLabel } from "@/features/import/script-formats";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listScenes } from "@/features/script/queries";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";
import { parseMmSs } from "@/shared/i18n/domain-labels";

export type ImportFieldKey =
  | "location"
  | "characters"
  | "timing"
  | "scriptDay"
  | "intExt"
  | "dayNight"
  | "script";

export type ImportPreviewScene = {
  key: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  location?: string;
  intExt?: string;
  characters: string[];
  timing?: string;
  scriptDay?: number;
  dayNight?: string;
  script?: string;
  existingId?: string;
  old?: {
    location?: string;
    intExt?: string | null;
    characters: string[];
    timing?: string;
    scriptDay?: number | null;
    dayNight?: string | null;
    script?: string | null;
  };
};

export type ImportActionState = {
  error?: string;
  success?: string;
  preview?: {
    jobId: string;
    fileName: string;
    scenes: ImportPreviewScene[];
  };
};

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

  const job = await prisma.scriptImportJob.create({
    data: {
      projectId,
      fileName: file.name,
      status: "preview",
      timingMethod,
      showComparison,
      previewData: scenes,
    },
  });

  return {
    preview: {
      jobId: job.id,
      fileName: file.name,
      scenes,
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

  const scenes = job.previewData as ImportPreviewScene[];
  let applied = 0;

  for (const scene of scenes) {
    const selected = formData.get(`sel_${scene.key}`) === "on";
    if (!selected) continue;

    const fields: ImportFieldKey[] = [
      "location",
      "characters",
      "timing",
      "scriptDay",
      "intExt",
      "dayNight",
      "script",
    ];
    const take = Object.fromEntries(
      fields.map((f) => [f, formData.get(`upd_${scene.key}_${f}`) === "on"]),
    ) as Record<ImportFieldKey, boolean>;

    if (!scene.existingId) {
      let locationId: string | undefined;
      if (scene.location) {
        const loc =
          (await prisma.location.findFirst({
            where: {
              projectId,
              name: { equals: scene.location, mode: "insensitive" },
            },
          })) ??
          (await prisma.location.create({
            data: { projectId, name: scene.location },
          }));
        locationId = loc.id;
      }

      const characterIds: string[] = [];
      for (const name of scene.characters) {
        const ch =
          (await prisma.character.findFirst({
            where: { projectId, name: { equals: name, mode: "insensitive" } },
          })) ??
          (await prisma.character.create({ data: { projectId, name } }));
        characterIds.push(ch.id);
      }

      const maxOrder = await prisma.scene.aggregate({
        where: { projectId },
        _max: { sortOrder: true },
      });

      await prisma.scene.create({
        data: {
          projectId,
          episodeNumber: scene.episodeNumber ?? 0,
          number: scene.number,
          postfix: scene.postfix ?? "",
          planSeconds: scene.timing ? parseMmSs(scene.timing) : undefined,
          scriptDay: scene.scriptDay,
          intExt: toIntExt(scene.intExt),
          dayNight: toDayNight(scene.dayNight),
          scriptContent: scene.script,
          summary: scene.location,
          sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
          locations: locationId
            ? { create: [{ locationId }] }
            : undefined,
          characters: characterIds.length
            ? { create: characterIds.map((characterId) => ({ characterId })) }
            : undefined,
        },
      });
      applied += 1;
      continue;
    }

    const data: Record<string, unknown> = {};
    if (take.timing && scene.timing) {
      data.planSeconds = parseMmSs(scene.timing);
    }
    if (take.scriptDay && scene.scriptDay != null) {
      data.scriptDay = scene.scriptDay;
    }
    if (take.dayNight && scene.dayNight) {
      data.dayNight = toDayNight(scene.dayNight);
    }
    if (take.intExt && scene.intExt) {
      data.intExt = toIntExt(scene.intExt);
    }
    if (take.script && scene.script != null) {
      data.scriptContent = scene.script;
    }

    if (Object.keys(data).length > 0) {
      await prisma.scene.update({
        where: { id: scene.existingId },
        data,
      });
    }

    if (take.location && scene.location) {
      const loc =
        (await prisma.location.findFirst({
          where: {
            projectId,
            name: { equals: scene.location, mode: "insensitive" },
          },
        })) ??
        (await prisma.location.create({
          data: { projectId, name: scene.location },
        }));
      await prisma.sceneLocation.deleteMany({
        where: { sceneId: scene.existingId },
      });
      await prisma.sceneLocation.create({
        data: { sceneId: scene.existingId, locationId: loc.id },
      });
    }

    if (take.characters) {
      const characterIds: string[] = [];
      for (const name of scene.characters) {
        const ch =
          (await prisma.character.findFirst({
            where: { projectId, name: { equals: name, mode: "insensitive" } },
          })) ??
          (await prisma.character.create({ data: { projectId, name } }));
        characterIds.push(ch.id);
      }
      await prisma.sceneCharacter.deleteMany({
        where: { sceneId: scene.existingId },
      });
      if (characterIds.length) {
        await prisma.sceneCharacter.createMany({
          data: characterIds.map((characterId) => ({
            sceneId: scene.existingId!,
            characterId,
          })),
        });
      }
    }

    applied += 1;
  }

  await prisma.scriptImportJob.update({
    where: { id: jobId },
    data: { status: "applied" },
  });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "script_import",
    entityId: jobId,
    action: "CREATE",
    summary: `Импортировано сцен: ${applied}`,
  });

  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/import`);

  return { success: `Импортировано: ${applied}` };
}
