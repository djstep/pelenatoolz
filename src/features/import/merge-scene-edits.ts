import type { ImportPreviewScene } from "@/features/import/types";

function optionalString(value: FormDataEntryValue | null) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function optionalInt(value: FormDataEntryValue | null) {
  const text = optionalString(value);
  if (text == null) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function mergeSceneEdits(
  scene: ImportPreviewScene,
  formData: FormData,
): ImportPreviewScene {
  const key = scene.key;
  const charactersRaw = optionalString(formData.get(`scene_${key}_characters`));

  return {
    ...scene,
    episodeNumber:
      optionalInt(formData.get(`scene_${key}_episodeNumber`)) ??
      scene.episodeNumber,
    number: optionalString(formData.get(`scene_${key}_number`)) ?? scene.number,
    postfix:
      formData.get(`scene_${key}_postfix`) != null
        ? String(formData.get(`scene_${key}_postfix`))
        : scene.postfix,
    location:
      optionalString(formData.get(`scene_${key}_location`)) ?? scene.location,
    intExt: optionalString(formData.get(`scene_${key}_intExt`)) ?? scene.intExt,
    characters: charactersRaw
      ? charactersRaw
          .split(/[,;]/)
          .map((name) => name.trim())
          .filter(Boolean)
      : scene.characters,
    timing: optionalString(formData.get(`scene_${key}_timing`)) ?? scene.timing,
    scriptDay:
      optionalInt(formData.get(`scene_${key}_scriptDay`)) ?? scene.scriptDay,
    dayNight:
      optionalString(formData.get(`scene_${key}_dayNight`)) ?? scene.dayNight,
    script: optionalString(formData.get(`scene_${key}_script`)) ?? scene.script,
  };
}
