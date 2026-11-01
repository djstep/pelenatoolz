import "server-only";

import type { ExistingSection } from "@/features/call-sheets/lib/elements-rules";
import { sectionRef } from "@/features/call-sheets/lib/elements-rules";
import {
  buildAutoRows,
  defaultSectionName,
  effectiveSections,
  mergeAutoRows,
  parseAutoKey,
  type AutoSourceScene,
  type ElementValues,
  type SavedElement,
} from "@/features/call-sheets/lib/sections";
import type { Tx } from "@/features/call-sheets/queries";
import { prisma } from "@/shared/db/prisma";

/** Разделы проекта из базы с числом строк вызывных — по порядку. */
export async function loadSectionsWithCounts(
  db: Pick<Tx, "callSheetSection">,
  projectId: string,
): Promise<ExistingSection[]> {
  const rows = await db.callSheetSection.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      sortOrder: true,
      _count: { select: { elements: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sortOrder,
    elementCount: row._count.elements,
  }));
}

export type SectionsEditorRow = {
  /** "" — раздела ещё нет в базе (системный, показан из кода). */
  id: string;
  /** Системный ключ; "" — свой раздел проекта. */
  key: string;
  name: string;
  /** Название системного раздела по умолчанию (подсказка); у своего — null. */
  defaultName: string | null;
  /** Строк вызывных в разделе (удалятся вместе с разделом). */
  elementCount: number;
};

/** Разделы для экрана «Шаблон вызывного». Ничего не пишет: недостающие системные — из кода. */
export async function getCallSheetSectionsEditor(
  projectId: string,
): Promise<SectionsEditorRow[]> {
  const existing = await loadSectionsWithCounts(prisma, projectId);
  const counts = new Map(existing.map((row) => [row.id, row.elementCount]));
  return effectiveSections(existing).map((row) => ({
    id: row.id ?? "",
    key: row.key ?? "",
    name: row.name,
    defaultName: defaultSectionName(row.key),
    elementCount: row.id ? (counts.get(row.id) ?? 0) : 0,
  }));
}

export type SpecialTransportRow = {
  name: string;
  callTime: string | null;
  wrapTime: string | null;
  scenes: string | null;
  notes: string | null;
};

/** Сцены дня с разбором и спецтранспорт дня — из чего собираются авто-строки. null — нет дня. */
export async function loadElementsAutoSource(
  db: Pick<Tx, "shootDay">,
  projectId: string,
  shootDayId: string,
): Promise<{ scenes: AutoSourceScene[]; transports: SpecialTransportRow[] } | null> {
  const day = await db.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    select: {
      scenes: {
        orderBy: { sortOrder: "asc" },
        select: {
          scene: {
            select: {
              cutAt: true,
              episodeNumber: true,
              number: true,
              postfix: true,
              resources: { select: { category: true, name: true, quantity: true } },
              elements: { select: { element: { select: { id: true, type: true, name: true } } } },
              resourceItems: {
                select: {
                  itemId: true,
                  quantity: true,
                  item: {
                    select: { name: true, category: { select: { name: true, perShift: true } } },
                  },
                },
              },
            },
          },
        },
      },
      transports: {
        orderBy: { sortOrder: "asc" },
        select: { name: true, callTime: true, wrapTime: true, scenes: true, notes: true },
      },
    },
  });
  if (!day) return null;
  return { scenes: day.scenes.map((row) => row.scene), transports: day.transports };
}

export const savedElementSelect = {
  sectionId: true,
  autoKey: true,
  hidden: true,
  name: true,
  quantity: true,
  scenes: true,
  arrivalTime: true,
  readyTime: true,
  wrapTime: true,
  notes: true,
  secondUnit: true,
  sortOrder: true,
} as const;

export type ElementsEditorSection = {
  /** id раздела или «key:КЛЮЧ» (системный, которого ещё нет в базе). */
  ref: string;
  key: string | null;
  name: string;
};

export type ElementsEditorData = {
  callSheetId: string;
  sections: ElementsEditorSection[];
  /** Авто-строки из сцен дня с правками этого вызывного. */
  autoRows: {
    autoKey: string;
    sectionRef: string;
    /** Значения из сцен — подсказка «как в сценах». */
    auto: { name: string; quantity: string; scenes: string };
    hidden: boolean;
    value: ElementValues;
  }[];
  /** Правки строк, которых больше нет в сценах дня. Только показ и «удалить». */
  orphans: {
    autoKey: string;
    sectionName: string;
    name: string;
    quantity: string;
    scenes: string;
    hidden: boolean;
  }[];
  /** Ручные строки по порядку. */
  manual: ({ sectionRef: string } & ElementValues)[];
  /** Спецтранспорт дня — только показ, правится в блоке «Спецтранспорт». */
  specialTransport: SpecialTransportRow[];
};

/** Как назвать правку строки, которой нет в сценах: своё название или элемент/позиция по id. */
async function orphanNames(projectId: string, orphans: SavedElement[]) {
  const elementIds: string[] = [];
  const itemIds: string[] = [];
  for (const row of orphans) {
    const parsed = parseAutoKey(row.autoKey ?? "");
    if (parsed?.kind === "el") elementIds.push(parsed.id);
    if (parsed?.kind === "item") itemIds.push(parsed.id);
  }
  const [elements, items] = await Promise.all([
    elementIds.length === 0
      ? Promise.resolve([])
      : prisma.element.findMany({
          where: { projectId, id: { in: elementIds } },
          select: { id: true, name: true },
        }),
    itemIds.length === 0
      ? Promise.resolve([])
      : prisma.resourceItem.findMany({
          where: { id: { in: itemIds }, category: { projectId } },
          select: { id: true, name: true },
        }),
  ]);
  const elementNames = new Map(elements.map((row) => [row.id, row.name]));
  const itemNames = new Map(items.map((row) => [row.id, row.name]));
  return (row: SavedElement): string => {
    if (row.name) return row.name;
    const parsed = parseAutoKey(row.autoKey ?? "");
    if (parsed?.kind === "res") return parsed.name;
    if (parsed?.kind === "el") return elementNames.get(parsed.id) ?? "Элемент удалён";
    if (parsed?.kind === "item") return itemNames.get(parsed.id) ?? "Позиция удалена";
    return "—";
  };
}

/**
 * Данные редактора «Элементы площадки» вызывного дня. null — вызывной ещё не создан.
 * Ничего не пишет: разделов в базе может не быть — тогда разделы по умолчанию из кода.
 */
export async function getCallSheetElementsEditor(
  projectId: string,
  shootDayId: string,
): Promise<ElementsEditorData | null> {
  const sheet = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId },
    select: {
      id: true,
      elements: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: savedElementSelect,
      },
    },
  });
  if (!sheet) return null;

  const [source, dbSections] = await Promise.all([
    loadElementsAutoSource(prisma, projectId, shootDayId),
    prisma.callSheetSection.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, key: true, name: true },
    }),
  ]);

  const sections = effectiveSections(dbSections).map((row) => ({
    ref: sectionRef(row),
    key: row.key,
    name: row.name,
  }));
  const refByKey = new Map(
    sections.filter((row) => row.key !== null).map((row) => [row.key!, row.ref]),
  );
  const nameById = new Map(dbSections.map((row) => [row.id, row.name]));

  const merged = mergeAutoRows(buildAutoRows(source?.scenes ?? []), sheet.elements);
  const nameOf = await orphanNames(projectId, merged.orphans);

  return {
    callSheetId: sheet.id,
    sections,
    autoRows: merged.rows.map((row) => ({
      autoKey: row.auto.autoKey,
      sectionRef: refByKey.get(row.auto.sectionKey) ?? "",
      auto: {
        name: row.auto.name,
        quantity: row.auto.quantity ?? "",
        scenes: row.auto.scenes,
      },
      hidden: row.hidden,
      value: row.value,
    })),
    orphans: merged.orphans.map((row) => ({
      autoKey: row.autoKey!,
      sectionName: nameById.get(row.sectionId) ?? "",
      name: nameOf(row),
      quantity: row.quantity ?? "",
      scenes: row.scenes ?? "",
      hidden: row.hidden,
    })),
    manual: sheet.elements
      .filter((row) => row.autoKey === null)
      .map((row) => ({
        sectionRef: row.sectionId,
        name: row.name,
        quantity: row.quantity ?? "",
        scenes: row.scenes ?? "",
        arrivalTime: row.arrivalTime ?? "",
        readyTime: row.readyTime ?? "",
        wrapTime: row.wrapTime ?? "",
        notes: row.notes ?? "",
        secondUnit: row.secondUnit,
      })),
    specialTransport: source?.transports ?? [],
  };
}
