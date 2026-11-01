import type { Permission } from "@/features/memberships/permissions";
import type { EntityFinanceTarget } from "@/features/roles/permissions-matrix";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

/** Кто смотрит отчёт смены: права из `requireProjectContext`. */
export type ReportViewer = {
  can: (permission: Permission) => boolean;
  canFinanceRead: (target: EntityFinanceTarget) => boolean;
  canFinanceWrite: (target: EntityFinanceTarget) => boolean;
};

/** Источник строки работы: актёр, позиция ресурса (с категорией), объект, спецтранспорт дня. */
export type WorkRowSource = {
  kind: "ACTOR" | "RESOURCE" | "TRANSPORT" | "LOCATION";
  /** Категория позиции ресурса; `null` — позиция удалена или строка не ресурс. */
  categoryId: string | null;
};

export type WorkRowAccess = {
  /** Строка видна: право просмотра источника (как у его карточки) или `finance:read`. */
  visible: boolean;
  /** Ставки, оплата, доп. выплаты строки — фин. просмотр источника. */
  financeRead: boolean;
  /** Доп. выплаты и «Обновить ставки» — фин. правка источника. */
  financeWrite: boolean;
};

/**
 * Права по источнику строки, как у карточек: актёр — фин. условия актёров, ресурс — его
 * категории, объект — объектов; спецтранспорт дня и ресурс без категории — `finance:read/write`.
 */
export function workRowAccess(viewer: ReportViewer, source: WorkRowSource): WorkRowAccess {
  const financeRole = viewer.can("finance:read");
  let sourceRead: boolean;
  let target: EntityFinanceTarget | null;
  switch (source.kind) {
    case "ACTOR":
      sourceRead = viewer.can("cast:read");
      target = "actors";
      break;
    case "LOCATION":
      sourceRead = viewer.can("script:read");
      target = "locations";
      break;
    case "RESOURCE":
      sourceRead = viewer.can("script:read");
      target = source.categoryId ? { categoryId: source.categoryId } : null;
      break;
    case "TRANSPORT":
    default:
      sourceRead = viewer.can("schedule:read");
      target = null;
      break;
  }
  return {
    visible: sourceRead || financeRole,
    financeRead: target ? viewer.canFinanceRead(target) : financeRole,
    financeWrite: target ? viewer.canFinanceWrite(target) : viewer.can("finance:write"),
  };
}

/**
 * Строка работы в браузере. Длительность смены, часы, переработка и километраж — рабочая
 * информация, видны всем, кто видит строку; деньги — только с фин. просмотром источника.
 */
export const WORK_ROW_FIELDS = {
  open: [
    "id",
    "reportId",
    "kind",
    "actorId",
    "resourceItemId",
    "locationId",
    "sourceKey",
    "displayName",
    "categoryLabel",
    "factStart",
    "factEnd",
    "lunchSkipped",
    "workedMin",
    "factOvertimeMin",
    "payableOvertimeMin",
    "shiftHoursMin",
    "unpaidOvertimeMin",
    "tracksMileage",
    "factKm",
    "sortOrder",
  ],
  finance: [
    "shiftRate",
    "taxPercent",
    "shiftPay",
    "overtimePay",
    "extrasPay",
    "kmRate",
    "mileagePay",
    "totalPay",
    "extras",
  ],
} as const;

/** Строки отчёта для браузера: невидимые убраны, деньги — по праву источника каждой строки. */
export function workRowsForViewer<
  T extends {
    kind: WorkRowSource["kind"];
    item?: { categoryId: string } | null;
  },
>(rows: T[], viewer: ReportViewer) {
  return rows.flatMap((row) => {
    const access = workRowAccess(viewer, {
      kind: row.kind,
      categoryId: row.item?.categoryId ?? null,
    });
    if (!access.visible) return [];
    return [
      {
        ...pickFinanceFields(row, WORK_ROW_FIELDS, access.financeRead),
        canSeePay: access.financeRead,
        canEditPay: access.financeWrite,
      },
    ];
  });
}

/** Строка «было → стало» по ставкам: без фин. просмотра — только имя (сам факт расхождения). */
export const RATE_CHANGE_FIELDS = {
  open: ["rowId", "name"],
  finance: ["fields", "pay"],
} as const;
