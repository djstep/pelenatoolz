import "server-only";
import type { Prisma } from "@prisma/client";
import { compareKey } from "@/features/import/normalize/text";
import { formatLocationTitle } from "@/features/locations/lib/format-location";
import type { prisma } from "@/shared/db/prisma";

/**
 * Объединение объектов («ЗАГОРОДНЫЙ ДОМ» → «ДОМ») и подобъектов («ДОМ.ДЕТСКАЯ/КОРИДОР» →
 * «ДОМ.ДЕТСКАЯ»). Объединяемая строка исчезает, все её связи переходят к оставшейся: сцены,
 * скаут, схема вызывного, строки отчётов смены, правила словаря, события календаря, фото,
 * точки схемы, ставки переработки; у объекта — его подобъекты (одноимённые сливаются).
 * Поля оставшейся не меняются; пустые заполняются из объединяемой.
 * Не серверное действие: id проверены на проект до вызова, вызывать внутри транзакции.
 */

type Db = Pick<
  typeof prisma,
  | "location"
  | "sceneLocation"
  | "scoutCandidateLocation"
  | "callSheet"
  | "productionReportWorkRow"
  | "scriptDictionaryRule"
  | "prepEvent"
  | "locationPhoto"
  | "locationPoint"
  | "locationOvertimeRate"
  | "$executeRaw"
>;

const ROW_SELECT = {
  id: true,
  projectId: true,
  name: true,
  parentId: true,
  parent: { select: { id: true, name: true } },
  locationKind: true,
  hasDecoration: true,
  address: true,
  tags: true,
  notes: true,
  requirementNotes: true,
  scoutSnapshot: true,
  sourceScoutCandidateId: true,
  shiftRate: true,
  shiftHoursMin: true,
  unpaidOvertimeMin: true,
  taxPercent: true,
  overtimeMode: true,
  unpaidOvertimeMode: true,
  defaultBudgetItemId: true,
  overtimeBudgetItemId: true,
  latitude: true,
  longitude: true,
  directions: true,
  parking: true,
  onSiteNotes: true,
  _count: { select: { overtimeRates: true, children: true } },
} as const satisfies Prisma.LocationSelect;

type Row = Prisma.LocationGetPayload<{ select: typeof ROW_SELECT }>;

export type MergeRefusal =
  | "same"
  | "not-found"
  | "kind"
  | "finance"
  | "report"
  | "budget";

export const MERGE_REFUSALS: Record<MergeRefusal, string> = {
  same: "Выберите другой объект",
  "not-found": "Объект не найден",
  kind: "Объединять можно объект с объектом или подобъект с подобъектом",
  finance:
    "У объединяемого есть финансовые условия (ставка, статьи сметы, переработки) — объединить может тот, у кого есть право на финансы объектов",
  report:
    "Оба в одном отчёте смены — строки аренды смешаются. Сначала уберите один из отчёта или объедините после смены",
  budget:
    "У объектов разные статьи сметы, а по объединяемому есть строки отчётов смены — начисления сместились бы в другую статью. Сначала сделайте статьи одинаковыми",
};

/** Стоимость в снимке утверждённого скаута — финансовое поле. */
function snapshotCost(row: Row) {
  const snapshot = row.scoutSnapshot as { cost?: unknown } | null;
  return snapshot && typeof snapshot === "object" && snapshot.cost != null;
}

/** Финансовые условия строки: без права на финансы объектов их нельзя переносить или терять. */
function hasFinance(row: Row) {
  return (
    snapshotCost(row) ||
    row.shiftRate != null ||
    row.shiftHoursMin != null ||
    row.unpaidOvertimeMin != null ||
    row.taxPercent != null ||
    row.defaultBudgetItemId != null ||
    row.overtimeBudgetItemId != null ||
    row._count.overtimeRates > 0
  );
}

/** Пары «объединяемая → оставшаяся»: сама строка и у объекта — одноимённые подобъекты. */
async function mergePairs(db: Db, source: Row, target: Row) {
  const pairs: { source: Row; target: Row }[] = [{ source, target }];
  const moved: Row[] = [];
  if (!source.parentId && source._count.children > 0) {
    const [sourceSubs, targetSubs] = await Promise.all([
      db.location.findMany({ where: { projectId: source.projectId, parentId: source.id }, select: ROW_SELECT }),
      db.location.findMany({ where: { projectId: target.projectId, parentId: target.id }, select: ROW_SELECT }),
    ]);
    const byKey = new Map(targetSubs.map((s) => [compareKey(s.name), s]));
    for (const sub of sourceSubs) {
      const same = byKey.get(compareKey(sub.name));
      if (same) pairs.push({ source: sub, target: same });
      else moved.push(sub);
    }
  }
  return { pairs, moved };
}

export type MergePlan =
  | { refusal: MergeRefusal }
  | {
      source: Row;
      target: Row;
      pairs: { source: Row; target: Row }[];
      moved: Row[];
      counts: {
        scenes: number;
        subsMoved: number;
        subsMerged: number;
        reportRows: number;
        /** Ставки переработки объединяемых, которые не перейдут (у оставшегося свои). */
        ratesDropped: number;
      };
    };

/** Что будет при объединении (и можно ли): для окна и для самой записи. */
export async function planLocationMerge(
  db: Db,
  projectId: string,
  sourceId: string,
  targetId: string,
  canWriteFinance: boolean,
): Promise<MergePlan> {
  if (sourceId === targetId) return { refusal: "same" };
  const [source, target] = await Promise.all([
    db.location.findFirst({ where: { id: sourceId, projectId }, select: ROW_SELECT }),
    db.location.findFirst({ where: { id: targetId, projectId }, select: ROW_SELECT }),
  ]);
  if (!source || !target) return { refusal: "not-found" };
  if (Boolean(source.parentId) !== Boolean(target.parentId)) return { refusal: "kind" };
  if (target.parentId === source.id) return { refusal: "kind" };

  const { pairs, moved } = await mergePairs(db, source, target);
  if (!canWriteFinance && pairs.some((p) => hasFinance(p.source))) return { refusal: "finance" };

  // Строки аренды: в одном отчёте ключ строки один — объединяемая и оставшаяся (и две
  // объединяемые в одну оставшуюся, «Кухня» и «КУХНЯ») в одном отчёте — отказ.
  const reportsOf = new Map<string, Set<string>>();
  let reportRows = 0;
  for (const pair of pairs) {
    if (!reportsOf.has(pair.target.id)) {
      const rows = await db.productionReportWorkRow.findMany({
        where: { locationId: pair.target.id },
        select: { reportId: true },
      });
      reportsOf.set(pair.target.id, new Set(rows.map((r) => r.reportId)));
    }
    const taken = reportsOf.get(pair.target.id)!;
    const sourceRows = await db.productionReportWorkRow.findMany({
      where: { locationId: pair.source.id },
      select: { reportId: true },
    });
    if (sourceRows.some((r) => taken.has(r.reportId))) return { refusal: "report" };
    for (const r of sourceRows) taken.add(r.reportId);
    reportRows += sourceRows.length;
    // Статьи сметы: начисления строк отчётов берут статью с объекта строки — разные статьи сдвинули бы план-факт.
    const differs = (a: string | null, b: string | null) => a != null && b != null && a !== b;
    if (
      sourceRows.length > 0 &&
      (differs(pair.source.defaultBudgetItemId, pair.target.defaultBudgetItemId) ||
        differs(pair.source.overtimeBudgetItemId, pair.target.overtimeBudgetItemId))
    ) {
      return { refusal: "budget" };
    }
  }

  const ids = [...pairs.map((p) => p.source.id), ...moved.map((m) => m.id)];
  const sceneLinks = await db.sceneLocation.findMany({
    where: { locationId: { in: ids } },
    select: { sceneId: true },
    distinct: ["sceneId"],
  });
  const ratesDropped = pairs
    .filter((p) => p.target._count.overtimeRates > 0)
    .reduce((sum, p) => sum + p.source._count.overtimeRates, 0);
  return {
    source,
    target,
    pairs,
    moved,
    counts: {
      scenes: sceneLinks.length,
      subsMoved: moved.length,
      subsMerged: pairs.length - 1,
      reportRows,
      ratesDropped,
    },
  };
}

/** Пустые поля оставшейся — из объединяемой; финансы — только с правом на финансы объектов. */
function filledFields(source: Row, target: Row, canWriteFinance: boolean) {
  const data: Prisma.LocationUncheckedUpdateInput = {};
  const empty = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
  const copy = <K extends keyof Row & keyof Prisma.LocationUncheckedUpdateInput>(key: K) => {
    if (empty(target[key]) && !empty(source[key])) {
      (data as Record<string, unknown>)[key] = source[key];
    }
  };
  for (const key of [
    "locationKind",
    "address",
    "tags",
    "notes",
    "requirementNotes",
    "latitude",
    "longitude",
    "directions",
    "parking",
    "onSiteNotes",
  ] as const) {
    copy(key);
  }
  if (empty(target.scoutSnapshot) && !empty(source.scoutSnapshot)) {
    data.scoutSnapshot = source.scoutSnapshot as Prisma.InputJsonValue;
    data.sourceScoutCandidateId = source.sourceScoutCandidateId;
  }
  if (source.hasDecoration && !target.hasDecoration) data.hasDecoration = true;
  if (canWriteFinance) {
    for (const key of [
      "shiftRate",
      "shiftHoursMin",
      "unpaidOvertimeMin",
      "taxPercent",
      "defaultBudgetItemId",
      "overtimeBudgetItemId",
    ] as const) {
      copy(key);
    }
    // Ставка переходит вместе со своим способом счёта переработки.
    if (target.shiftRate == null && source.shiftRate != null) {
      data.overtimeMode = source.overtimeMode;
      data.unpaidOvertimeMode = source.unpaidOvertimeMode;
    }
  }
  return data;
}

/** Все связи одной строки → другой. */
async function moveLinks(db: Db, from: Row, to: Row, canWriteFinance: boolean) {
  // Сцены и скаут: связь уже есть у оставшейся — лишняя удаляется.
  const targetScenes = await db.sceneLocation.findMany({ where: { locationId: to.id }, select: { sceneId: true } });
  await db.sceneLocation.deleteMany({
    where: { locationId: from.id, sceneId: { in: targetScenes.map((s) => s.sceneId) } },
  });
  await db.sceneLocation.updateMany({ where: { locationId: from.id }, data: { locationId: to.id } });

  const targetScout = await db.scoutCandidateLocation.findMany({
    where: { locationId: to.id },
    select: { scoutCandidateId: true },
  });
  await db.scoutCandidateLocation.deleteMany({
    where: { locationId: from.id, scoutCandidateId: { in: targetScout.map((s) => s.scoutCandidateId) } },
  });
  await db.scoutCandidateLocation.updateMany({ where: { locationId: from.id }, data: { locationId: to.id } });

  await db.callSheet.updateMany({ where: { schemeLocationId: from.id }, data: { schemeLocationId: to.id } });
  // Правило «к какой записи привязать» хранит id и в ответе: иначе оно станет «устаревшим».
  await db.scriptDictionaryRule.updateMany({
    where: { targetLocationId: from.id, answer: from.id },
    data: { targetLocationId: to.id, answer: to.id },
  });
  await db.scriptDictionaryRule.updateMany({ where: { targetLocationId: from.id }, data: { targetLocationId: to.id } });
  await db.prepEvent.updateMany({ where: { locationId: from.id }, data: { locationId: to.id } });

  // Строки аренды отчётов смены: тот же ключ «location:<id>» — «Обновить из КПП» их узнает.
  await db.productionReportWorkRow.updateMany({
    where: { locationId: from.id, sourceKey: `location:${from.id}` },
    data: { locationId: to.id, sourceKey: `location:${to.id}` },
  });
  await db.productionReportWorkRow.updateMany({ where: { locationId: from.id }, data: { locationId: to.id } });

  // Фото и точки схемы — в конец оставшейся.
  const [photoMax, pointMax] = await Promise.all([
    db.locationPhoto.aggregate({ where: { locationId: to.id }, _max: { sortOrder: true } }),
    db.locationPoint.aggregate({ where: { locationId: to.id }, _max: { sortOrder: true } }),
  ]);
  const photos = await db.locationPhoto.findMany({ where: { locationId: from.id }, select: { id: true, sortOrder: true } });
  for (const photo of photos) {
    await db.locationPhoto.update({
      where: { id: photo.id },
      data: { locationId: to.id, sortOrder: (photoMax._max.sortOrder ?? 0) + 1 + photo.sortOrder },
    });
  }
  const points = await db.locationPoint.findMany({ where: { locationId: from.id }, select: { id: true, sortOrder: true } });
  for (const point of points) {
    await db.locationPoint.update({
      where: { id: point.id },
      data: { locationId: to.id, sortOrder: (pointMax._max.sortOrder ?? 0) + 1 + point.sortOrder },
    });
  }

  // Ставки переработки: у оставшейся свои — объединяемой не переносятся; нет — переходят.
  if (canWriteFinance && to._count.overtimeRates === 0) {
    await db.locationOvertimeRate.updateMany({ where: { locationId: from.id }, data: { locationId: to.id } });
  }

  const fill = filledFields(from, to, canWriteFinance);
  if (Object.keys(fill).length > 0) await db.location.update({ where: { id: to.id }, data: fill });
}

/** Объединение по плану `planLocationMerge` (без отказа). Возвращает текст для журнала. */
export async function applyLocationMerge(
  db: Db,
  plan: Exclude<MergePlan, { refusal: MergeRefusal }>,
  canWriteFinance: boolean,
) {
  const { source, target, pairs, moved } = plan;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`location-order:${target.id}`}))`;

  // Подобъекты без пары — к оставшемуся объекту, в конец.
  if (moved.length > 0) {
    const last = await db.location.aggregate({ where: { parentId: target.id }, _max: { sortOrder: true } });
    let order = (last._max.sortOrder ?? 0) + 1;
    for (const sub of moved) {
      await db.location.update({ where: { id: sub.id }, data: { parentId: target.id, sortOrder: order++ } });
    }
  }
  // Сначала подобъекты, потом сама строка: у удаляемого объекта не остаётся подобъектов.
  for (const pair of [...pairs].reverse()) {
    await moveLinks(db, pair.source, pair.target, canWriteFinance);
    await db.location.delete({ where: { id: pair.source.id } });
  }
  return `«${formatLocationTitle(source)}» объединён с «${formatLocationTitle(target)}»`;
}
