import type { ProjectType } from "@prisma/client";
import type { CellRichTextValue } from "exceljs";
import {
  formatLocationCell,
  formatPlaceCell,
  formatSceneNumber,
  getActorNames,
  getExtras,
  getGroup,
  getMakeup,
  getStatusDateLabel,
  getStunt,
  type LibrettoScene,
} from "@/features/script/lib/libretto-display";
import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
} from "@/shared/i18n/domain-labels";
import { getLibrettoFieldLabel } from "@/features/script/lib/libretto-fields";

const CELL_FONT = { name: "Calibri", size: 11 } as const;

export function getLibrettoCellValue(
  scene: LibrettoScene,
  fieldId: string,
  projectType: ProjectType,
): string {
  switch (fieldId) {
    case "number":
      return formatSceneNumber(scene, projectType);
    case "location":
      return formatLocationCell(scene);
    case "place":
      return formatPlaceCell(scene);
    case "summary":
      return scene.summary ?? "—";
    case "characters":
      return scene.characters.map((c) => c.character.name).join(", ") || "—";
    case "actors":
      return getActorNames(scene).join(", ") || "—";
    case "planSeconds":
      return formatSecondsMmSs(scene.planSeconds);
    case "factSeconds":
      return formatSecondsMmSs(scene.factSeconds);
    case "preEditSeconds":
      return formatSecondsMmSs(scene.preEditSeconds);
    case "editSeconds":
      return formatSecondsMmSs(scene.editSeconds);
    case "filmFootagePlan":
      return scene.filmFootagePlan?.toString() ?? "—";
    case "filmFootageFact":
      return scene.filmFootageFact?.toString() ?? "—";
    case "intExt":
      return scene.intExt ? intExtLabels[scene.intExt] : "—";
    case "scriptDay":
      return scene.scriptDay != null ? String(scene.scriptDay) : "—";
    case "dayNight":
      return scene.dayNight ? dayNightLabels[scene.dayNight] : "—";
    case "status":
      return getStatusDateLabel(scene);
    case "montageMap":
      return scene.montageMap ?? "—";
    case "description":
      return scene.description ?? "—";
    case "extras":
      return getExtras(scene);
    case "group":
      return getGroup(scene);
    case "stunt":
      return getStunt(scene);
    case "makeup":
      return getMakeup(scene);
    default:
      return "—";
  }
}

export function isEmptyLibrettoValue(value: string) {
  return !value || value === "—";
}

export function buildLibrettoExportCell(
  scene: LibrettoScene,
  fieldIds: string[],
  projectType: ProjectType,
): string | CellRichTextValue {
  const values = fieldIds
    .map((id) => ({
      id,
      label: getLibrettoFieldLabel(id),
      value: getLibrettoCellValue(scene, id, projectType),
    }))
    .filter((item) => !isEmptyLibrettoValue(item.value));

  if (values.length === 0) return "—";
  if (fieldIds.length === 1) return values[0]!.value;

  const richText: CellRichTextValue["richText"] = [];
  for (let i = 0; i < values.length; i++) {
    if (i > 0) richText.push({ text: "\n", font: { ...CELL_FONT } });
    richText.push({
      font: { ...CELL_FONT, bold: true },
      text: `${values[i]!.label}: `,
    });
    richText.push({ font: { ...CELL_FONT }, text: values[i]!.value });
  }
  return { richText };
}
