import type { DayNight, IntExt } from "@prisma/client";
import type { ImportPreviewScene } from "@/features/import/types";
import { prisma } from "@/shared/db/prisma";
import { parseMmSs } from "@/shared/i18n/domain-labels";

export type ImportFieldKey =
  | "location"
  | "characters"
  | "timing"
  | "scriptDay"
  | "intExt"
  | "dayNight"
  | "script";

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

export async function applyScenesFromPreview(
  projectId: string,
  scenes: ImportPreviewScene[],
  formData: FormData,
) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const scene of scenes) {
    const selected = formData.get(`sel_${scene.key}`) === "on";
    if (!selected) {
      skipped += 1;
      continue;
    }

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
      created += 1;
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

    updated += 1;
  }

  return { created, updated, skipped };
}
