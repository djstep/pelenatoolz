import {
  buildCastForDay,
  buildDayStats,
  buildPerShiftResources,
  buildResourceTables,
  buildShootingSlotDetails,
  formatSceneLine,
  inferDayNightLabel,
  slotDurationLabel,
  type CastRow,
  type DayDocBundle,
  type ResourceTableRow,
} from "@/features/day-docs/lib/build-day-doc";
import type { DayAstro } from "@/features/day-docs/lib/city-astro";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import type { getNextShootDayBrief } from "@/features/day-docs/queries";
import { formatPagesMinutes } from "@/features/schedule/lib/day-summary";
import {
  actorRoleTypeLabels,
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { formatDateLong, formatDateShort } from "@/shared/i18n/format-date";

type NextDay = Awaited<ReturnType<typeof getNextShootDayBrief>>;

export type CallSheetExportSlot = {
  timeRange: string;
  duration: string | null;
  typeLabel: string;
  title: string | null;
  details: string[];
  notes: string | null;
};

export type CallSheetResourceSection = {
  title: string;
  rows: ResourceTableRow[];
  showMakeup: boolean;
  showCostume: boolean;
};

export type CallSheetExportModel = {
  fileBaseName: string;
  documentTitle: string;
  projectName: string;
  dateLabel: string;
  city: string | null;
  headerLine: string;
  badges: string[];
  meta: { label: string; value: string }[];
  notes: string | null;
  departments: { role: string; person: string; info: string }[];
  transports: { name: string; info: string; notes: string | null }[];
  slots: CallSheetExportSlot[];
  cast: CastRow[];
  perShiftResources: ReturnType<typeof buildPerShiftResources>;
  resourceSections: CallSheetResourceSection[];
  scenesSummary: { scene: string; characters: string; timing: string }[];
  locationsSummary: string | null;
  nextDay: {
    label: string;
    scenes: string;
    locations: string | null;
    astro: string | null;
  } | null;
};

function cell(value: string) {
  return value || "—";
}

function joinParts(parts: (string | null | undefined)[], sep = " · ") {
  return parts.filter(Boolean).join(sep) || "—";
}

export function buildCallSheetExportModel(
  bundle: DayDocBundle,
  astro: DayAstro | null,
  nextDay: NextDay,
  nextDayAstro: DayAstro | null,
): CallSheetExportModel {
  const { project, day } = bundle;
  const stats = buildDayStats(day);
  const cast = buildCastForDay(bundle);
  const resources = buildResourceTables(bundle);
  const perShiftResources = buildPerShiftResources(bundle);
  const dayNight = inferDayNightLabel(day);
  const sceneById = new Map(day.scenes.map((s) => [s.scene.id, s]));

  const weatherParts = [
    astro?.weatherSummary && !astro.weatherUnavailable
      ? astro.weatherSummary
      : day.weatherNote,
    day.weatherPrecip || (astro?.precipProb ? `осадки ${astro.precipProb}%` : null),
    astro?.weatherUnavailable ? astro.weatherSummary : null,
  ].filter(Boolean);

  const badges = [
    shootDayTypeLabels[day.dayType],
    shootDayStatusLabels[day.status],
    day.isNightShift ? "Ночная смена" : null,
    day.isLocked ? "Зафиксирован" : null,
    day.unit && day.unit !== "main" ? `Группа ${day.unit}` : null,
  ].filter(Boolean) as string[];

  const meta: CallSheetExportModel["meta"] = [
    { label: "№ смены", value: cell(day.shiftNumber?.toString() ?? "") },
    { label: "День / ночь", value: dayNight },
    { label: "Погода", value: joinParts(weatherParts as string[]) },
    { label: "Восход", value: cell(astro?.sunrise ?? "") },
    { label: "Закат", value: cell(astro?.sunset ?? "") },
    { label: "Сбор группы", value: cell(day.crewMeetTime || day.callTime || "") },
    { label: "Место сбора", value: cell(day.crewMeetAddress ?? "") },
    { label: "Начало смены", value: cell(day.shiftStartTime || day.callTime || "") },
    { label: "Репетиция", value: cell(day.rehearsalTime ?? "") },
    { label: "Мотор", value: cell(day.motorOnTime ?? "") },
    { label: "Стоп-мотор", value: cell(day.motorOffTime ?? "") },
    { label: "Конец смены", value: cell(day.wrapTime ?? "") },
    { label: "Сцены", value: String(stats.sceneCount) },
    { label: "Хронометраж", value: stats.timingLabel },
    { label: "Страницы", value: stats.pagesLabel },
  ];

  const slots: CallSheetExportSlot[] = day.timeSlots.map((slot) => {
    const assignment = slot.sceneId ? sceneById.get(slot.sceneId) : undefined;
    const details =
      slot.slotType === "SHOOTING" && assignment
        ? buildShootingSlotDetails(assignment.scene, assignment.notes)
        : null;

    const timeRange = `${slot.startTime}${slot.endTime ? `–${slot.endTime}` : ""}`;
    const duration = slot.endTime
      ? slotDurationLabel(slot.startTime, slot.endTime)
      : null;

    if (!details) {
      return {
        timeRange,
        duration,
        typeLabel: timeSlotTypeLabels[slot.slotType],
        title: slot.notes,
        details: [],
        notes: slot.notes,
      };
    }

    const detailLines = [
      details.summary ? `Синопсис: ${details.summary}` : null,
      details.characters.length ? `Персонажи: ${details.characters.join(", ")}` : null,
      details.extras.length ? `Массовка: ${details.extras.join(", ")}` : null,
      details.groups.length ? `Групповка: ${details.groups.join(", ")}` : null,
      details.stunts.length ? `Каскадёры: ${details.stunts.join(", ")}` : null,
      details.makeup.length ? `Грим: ${details.makeup.join(", ")}` : null,
      details.costumes.length ? `Костюм: ${details.costumes.join(", ")}` : null,
      details.props.length ? `Реквизит: ${details.props.join(", ")}` : null,
      details.vehicles.length ? `Транспорт: ${details.vehicles.join(", ")}` : null,
      details.camera.length ? `Операторская: ${details.camera.join(", ")}` : null,
      details.notes ? `Примечание: ${details.notes}` : null,
    ].filter(Boolean) as string[];

    const title = [
      `Сцена ${details.sceneNumber}`,
      details.location,
      details.scriptDay != null ? `сценарный день ${details.scriptDay}` : null,
      details.locationAddress,
      `Хрон. ${details.planLabel}`,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      timeRange,
      duration,
      typeLabel: timeSlotTypeLabels[slot.slotType],
      title,
      details: detailLines,
      notes: null,
    };
  });

  const resourceSections: CallSheetResourceSection[] = [
    { title: "Массовка", rows: resources.extras, showMakeup: true, showCostume: true },
    {
      title: "Трюк / каскадёры",
      rows: resources.stunts,
      showMakeup: false,
      showCostume: false,
    },
    { title: "Художественный цех", rows: resources.art, showMakeup: false, showCostume: true },
    {
      title: "Операторская техника",
      rows: resources.camera,
      showMakeup: false,
      showCostume: false,
    },
    { title: "Реквизит", rows: resources.props, showMakeup: false, showCostume: true },
    {
      title: "Игровой транспорт / спецтехника на сцену",
      rows: resources.vehicles,
      showMakeup: false,
      showCostume: false,
    },
    ...resources.catalog.map((section) => ({
      title: section.categoryName,
      rows: section.rows,
      showMakeup: true,
      showCostume: true,
    })),
  ].filter((section) => section.rows.length > 0);

  const dateLabel = formatDateLong(day.date);
  const fileBaseName = `call-sheet-day-${day.dayNumber}-${formatDateShort(day.date, { utc: true }).replace(/\s/g, "-")}`;

  return {
    fileBaseName,
    documentTitle: `Вызывной · День ${day.dayNumber}`,
    projectName: project.fullName || project.name,
    dateLabel,
    city: project.city,
    headerLine: `День ${day.dayNumber}${day.shiftNumber ? ` · Смена ${day.shiftNumber}` : ""}`,
    badges,
    meta,
    notes: [day.notes, day.comment].filter(Boolean).join(" · ") || null,
    departments: day.departmentCalls.map((d) => ({
      role: d.roleLabel,
      person: d.personName || "—",
      info: joinParts([
        d.callTime ? `явка ${d.callTime}` : null,
        d.phone,
      ]),
    })),
    transports: day.transports.map((t) => ({
      name: t.name,
      info: t.callTime ? `прибытие ${t.callTime}` : "время не указано",
      notes: t.notes,
    })),
    slots,
    cast,
    perShiftResources,
    resourceSections,
    scenesSummary: day.scenes.map((row) => ({
      scene: formatSceneLine(row.scene),
      characters:
        row.scene.characters.map((c) => c.character.name).join(", ") || "—",
      timing: formatPagesMinutes(
        row.estimatedPages ?? row.scene.pageCount,
        row.scene.planSeconds,
      ),
    })),
    locationsSummary:
      stats.locations.length > 0 ? stats.locations.join(", ") : null,
    nextDay: nextDay
      ? {
          label: `День ${nextDay.dayNumber} · ${formatDateShort(nextDay.date)}`,
          scenes:
            nextDay.scenes.length > 0
              ? nextDay.scenes
                  .map((s) => {
                    const sc = s.scene;
                    const ep = sc.episodeNumber > 0 ? `${sc.episodeNumber}-` : "";
                    return `${ep}${sc.number}${sc.postfix}`;
                  })
                  .join(", ")
              : "не запланированы",
          locations:
            nextDay.scenes.length > 0
              ? [
                  ...new Set(
                    nextDay.scenes.flatMap((s) =>
                      s.scene.locations.map((l) => l.location.name),
                    ),
                  ),
                ].join(", ")
              : null,
          astro: nextDayAstro
            ? joinParts([
                nextDayAstro.sunrise ? `↑ ${nextDayAstro.sunrise}` : null,
                nextDayAstro.sunset ? `↓ ${nextDayAstro.sunset}` : null,
                nextDayAstro.weatherSummary,
              ])
            : null,
        }
      : null,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlTable(
  headers: string[],
  rows: string[][],
) {
  if (rows.length === 0) return "";
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table class="data-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function htmlSection(title: string, body: string) {
  if (!body.trim()) return "";
  return `<section class="block"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

export function buildCallSheetPrintHtml(model: CallSheetExportModel) {
  const metaHtml = `<dl class="meta-grid">${model.meta
    .map(
      (item) =>
        `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`,
    )
    .join("")}</dl>`;

  const departmentsHtml =
    model.departments.length > 0
      ? model.departments
          .map(
            (d) =>
              `<div class="card"><strong>${escapeHtml(d.role)}</strong><br/>${escapeHtml(d.person)}<br/><span class="muted">${escapeHtml(d.info)}</span></div>`,
          )
          .join("")
      : "";

  const transportsHtml =
    model.transports.length > 0
      ? model.transports
          .map(
            (t) =>
              `<div class="card"><strong>${escapeHtml(t.name)}</strong><br/><span class="muted">${escapeHtml(t.info)}</span>${t.notes ? `<br/><span class="muted">${escapeHtml(t.notes)}</span>` : ""}</div>`,
          )
          .join("")
      : "";

  const slotsHtml =
    model.slots.length > 0
      ? model.slots
          .map((slot) => {
            const head = `<p class="slot-head"><strong>${escapeHtml(slot.timeRange)}</strong> · ${escapeHtml(slot.typeLabel)}${slot.duration ? ` · ${escapeHtml(slot.duration)}` : ""}</p>`;
            const title = slot.title
              ? `<p>${escapeHtml(slot.title)}</p>`
              : "";
            const details = slot.details
              .map((line) => `<p class="muted">${escapeHtml(line)}</p>`)
              .join("");
            const notes = slot.notes
              ? `<p class="muted">${escapeHtml(slot.notes)}</p>`
              : "";
            return `<div class="slot">${head}${title}${details}${notes}</div>`;
          })
          .join("")
      : `<p class="muted">Расписание по слотам не задано.</p>`;

  const castHtml = htmlTable(
    [
      "Персонаж",
      "Актёр",
      "Сцены",
      "Подача",
      "Прибытие",
      "Костюм",
      "Грим",
      "Готовность / Конец",
      "Контакт",
    ],
    model.cast.map((row) => [
      row.characterName,
      joinParts([
        row.actorName ?? "не назначен",
        row.roleType
          ? actorRoleTypeLabels[
              row.roleType as keyof typeof actorRoleTypeLabels
            ]
          : null,
      ]),
      row.sceneNumbers.join(", "),
      row.pickup ?? "",
      row.arrival ?? "",
      row.costume ?? "",
      row.makeup ?? "",
      joinParts([row.ready, row.wrap ? `/ ${row.wrap}` : null]),
      joinParts([row.phone, row.email]),
    ]),
  );

  const perShiftHtml = htmlTable(
    ["Категория", "Ресурс", "Прибытие", "Готовность", "Конец смены"],
    model.perShiftResources.map((row) => [
      row.categoryName,
      row.notes ? `${row.itemName} (${row.notes})` : row.itemName,
      row.arrival ?? "",
      row.ready ?? "",
      row.wrap ?? "",
    ]),
  );

  const resourceSectionsHtml = model.resourceSections
    .map((section) => {
      const headers = [
        "Наименование",
        "Сцены",
        "Прибытие",
        ...(section.showCostume ? ["Костюм"] : []),
        ...(section.showMakeup ? ["Грим"] : []),
        "Готовность",
        "Конец",
      ];
      const rows = section.rows.map((row) => [
        row.name,
        row.sceneNumbers.join(", "),
        row.arrival ?? "",
        ...(section.showCostume ? [row.costume ?? ""] : []),
        ...(section.showMakeup ? [row.makeup ?? ""] : []),
        row.ready ?? "",
        row.wrap ?? "",
      ]);
      return htmlSection(section.title, htmlTable(headers, rows));
    })
    .join("");

  const scenesHtml = htmlTable(
    ["Сцена", "Персонажи", "Хрон."],
    model.scenesSummary.map((row) => [row.scene, row.characters, row.timing]),
  );

  const nextDayHtml = model.nextDay
    ? `<p><strong>${escapeHtml(model.nextDay.label)}</strong></p>
       ${model.nextDay.astro ? `<p class="muted">${escapeHtml(model.nextDay.astro)}</p>` : ""}
       <p>Сцены: ${escapeHtml(model.nextDay.scenes)}</p>
       ${model.nextDay.locations ? `<p class="muted">Объекты: ${escapeHtml(model.nextDay.locations)}</p>` : ""}`
    : "";

  const body = [
    htmlSection(
      "Съёмочный день",
      `<h1>${escapeHtml(model.projectName)}</h1>
       <p class="muted">${escapeHtml(model.dateLabel)}${model.city ? ` · ${escapeHtml(model.city)}` : ""}</p>
       <p>${escapeHtml(model.headerLine)} · ${model.badges.map(escapeHtml).join(" · ")}</p>
       ${metaHtml}
       ${model.notes ? `<p class="note">${escapeHtml(model.notes)}</p>` : ""}`,
    ),
    model.departments.length
      ? htmlSection(
          "Руководители группы / контакты по цехам",
          `<div class="cards">${departmentsHtml}</div>`,
        )
      : "",
    model.transports.length
      ? htmlSection("Спецтранспорт", `<div class="cards">${transportsHtml}</div>`)
      : "",
    htmlSection("Расписание дня", slotsHtml),
    htmlSection("Актёры", castHtml || `<p class="muted">В сценах дня нет персонажей.</p>`),
    model.perShiftResources.length
      ? htmlSection("Посменные ресурсы", perShiftHtml)
      : "",
    resourceSectionsHtml,
    htmlSection(
      "Сцены дня (сводка)",
      `${scenesHtml}${model.locationsSummary ? `<p class="muted">Объекты: ${escapeHtml(model.locationsSummary)}</p>` : ""}`,
    ),
    model.nextDay
      ? htmlSection("Следующий съёмочный день", nextDayHtml)
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(model.documentTitle)}</title>
  <style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.35; color: #111; }
    h1 { font-size: 16pt; margin: 0 0 4px; }
    h2 { font-size: 12pt; margin: 0 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .block { margin-bottom: 16px; page-break-inside: avoid; }
    .muted { color: #444; font-size: 9pt; }
    .note { margin-top: 8px; padding: 8px; border: 1px solid #ddd; background: #f8f8f8; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 16px; margin-top: 10px; }
    .meta-grid dt { color: #555; font-size: 9pt; }
    .meta-grid dd { margin: 0; font-weight: 600; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .card { border: 1px solid #ddd; padding: 8px; border-radius: 4px; }
    .slot { border: 1px solid #ddd; padding: 8px; margin-bottom: 8px; border-radius: 4px; }
    .slot-head { margin: 0 0 4px; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    .data-table th, .data-table td { border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; }
    .data-table th { background: #f3f3f3; text-align: left; }
  </style>
</head>
<body>${body}</body>
</html>`;
}
