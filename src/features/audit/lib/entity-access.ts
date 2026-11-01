import type { Permission } from "@/features/memberships/permissions";
import type { NavAccess } from "@/features/projects/lib/project-nav-groups";
import type { EntityFinanceTarget } from "@/features/roles/permissions-matrix";
import {
  AuditEntityType,
  type AuditEntityTypeValue,
} from "@/shared/audit/entity-types";

/**
 * Кто смотрит журнал: права из того же контекста проекта, что меню (`navAccessFromContext`),
 * и фин. просмотр — тот же `canFinanceRead`, что в разделах.
 */
export type AuditViewer = NavAccess & {
  canFinanceRead: (target: EntityFinanceTarget) => boolean;
};

type AuditVisibility = (viewer: AuditViewer) => boolean;

function anyOf(...permissions: Permission[]): AuditVisibility {
  return (viewer) => permissions.some((p) => viewer.can(p));
}

const scenes = anyOf("script:read");
const cast = anyOf("cast:read");
const schedule = anyOf("schedule:read");
const finance = anyOf("finance:read");
const contracts = anyOf("contracts:read");
// Как canReadAllSmeta (features/smeta/lib/smeta-access.ts). Главы цехов сметы в журнале не видят.
const smetaAll: AuditVisibility = (v) => v.isProducer || v.can("smeta:read_all");

/**
 * Запись журнала видна, если виден раздел её сущности. Условия — как у пунктов меню
 * (`project-nav-groups.ts`). Нового типа без условия TypeScript не пропустит.
 */
const AUDIT_ENTITY_VISIBILITY: Record<AuditEntityTypeValue, AuditVisibility> = {
  [AuditEntityType.scene]: scenes,
  [AuditEntityType.scriptVersion]: scenes,
  [AuditEntityType.scriptImport]: scenes,
  [AuditEntityType.scriptDictionaryRule]: scenes,
  [AuditEntityType.scriptComment]: scenes,
  [AuditEntityType.location]: scenes,
  [AuditEntityType.locationPhoto]: scenes,
  [AuditEntityType.scoutCandidate]: scenes,
  [AuditEntityType.resourceCategory]: scenes,
  [AuditEntityType.resourceItem]: scenes,
  [AuditEntityType.projectFile]: anyOf("script:read", "project:read"),
  [AuditEntityType.cloudFileLink]: anyOf("script:read", "project:read"),
  [AuditEntityType.character]: cast,
  [AuditEntityType.actor]: cast,
  [AuditEntityType.castingPerson]: cast,
  [AuditEntityType.castingCandidate]: cast,
  [AuditEntityType.audition]: cast,
  [AuditEntityType.auditionSchedule]: cast,
  [AuditEntityType.auditionBreak]: cast,
  [AuditEntityType.castingComment]: cast,
  [AuditEntityType.shootDay]: schedule,
  [AuditEntityType.callSheet]: anyOf("callsheet:read", "schedule:read"),
  [AuditEntityType.callSheetTemplate]: anyOf("callsheet:read", "schedule:read"),
  // Профиль пишется без проекта и в журнал проекта не попадает. Условие — самое строгое.
  [AuditEntityType.userProfile]: anyOf("members:manage"),
  [AuditEntityType.availabilityRow]: anyOf("schedule:read", "cast:read"),
  [AuditEntityType.productionReport]: anyOf("report:read", "schedule:read"),
  [AuditEntityType.payment]: anyOf("report:read", "schedule:read"),
  [AuditEntityType.financeOp]: finance,
  [AuditEntityType.financeVariable]: finance,
  [AuditEntityType.accrual]: finance,
  [AuditEntityType.cashPayment]: finance,
  [AuditEntityType.contract]: contracts,
  [AuditEntityType.act]: contracts,
  [AuditEntityType.certificate]: contracts,
  [AuditEntityType.ledgerType]: contracts,
  [AuditEntityType.counterparty]: anyOf("finance:read", "contracts:read"),
  [AuditEntityType.company]: anyOf("finance:read", "contracts:read"),
  [AuditEntityType.approvalStatus]: anyOf("finance:read", "contracts:read"),
  [AuditEntityType.postTask]: anyOf("post:read"),
  [AuditEntityType.role]: anyOf("members:read"),
  [AuditEntityType.membership]: anyOf("members:read"),
  [AuditEntityType.invite]: anyOf("members:read"),
  [AuditEntityType.project]: anyOf("project:read"),
  // Как canManageDepartments (features/smeta/lib/smeta-access.ts) — меню «Цеха».
  [AuditEntityType.department]: (v) => v.isProducer || v.can("members:manage"),
  [AuditEntityType.budget]: smetaAll,
  [AuditEntityType.budgetVersion]: smetaAll,
  [AuditEntityType.budgetLine]: smetaAll,
  [AuditEntityType.budgetTemplate]: smetaAll,
  [AuditEntityType.smetaExport]: smetaAll,
};

/** Старые значения в базе, которые код больше не пишет. */
const LEGACY_ENTITY_VISIBILITY: Record<string, AuditVisibility> = {
  ShootDay: schedule,
  shoot_day_scene: schedule,
};

const ENTITY_VISIBILITY: Record<string, AuditVisibility> = {
  ...AUDIT_ENTITY_VISIBILITY,
  ...LEGACY_ENTITY_VISIBILITY,
};

/**
 * Типы записей, которые видит пользователь. `null` — без ограничения (продюсер): только он
 * видит и записи типов, которых нет в карте.
 */
export function visibleAuditEntityTypes(viewer: AuditViewer): string[] | null {
  if (viewer.isProducer) return null;
  return Object.entries(ENTITY_VISIBILITY)
    .filter(([, visible]) => visible(viewer))
    .map(([type]) => type);
}

/** Тип записи, у которой есть фин. поля, и что нужно знать для проверки права на них. */
type FinanceFieldsRule = {
  fields: readonly string[];
  canRead: (viewer: AuditViewer, entity: { categoryId: string | null }) => boolean;
};

/**
 * Фин. поля в `changes` записей, видимых без финансов. Без права поле убирается целиком.
 * «Статьи сметы по умолчанию» (`before` / `after`) — фин. условия актёра, объекта, ресурса.
 */
const FINANCE_FIELDS: Partial<Record<string, FinanceFieldsRule>> = {
  [AuditEntityType.actor]: {
    fields: ["before", "after"],
    canRead: (v) => v.canFinanceRead("actors"),
  },
  [AuditEntityType.location]: {
    fields: ["before", "after"],
    canRead: (v) => v.canFinanceRead("locations"),
  },
  [AuditEntityType.resourceItem]: {
    fields: ["before", "after"],
    // Ресурс удалён — категории нет, поле скрывается.
    canRead: (v, entity) =>
      entity.categoryId !== null && v.canFinanceRead({ categoryId: entity.categoryId }),
  },
  [AuditEntityType.productionReport]: {
    fields: ["rateChanges"],
    canRead: (v) => v.can("finance:read"),
  },
};

/** Записи этих типов требуют категорию ресурса для проверки фин. полей. */
export const AUDIT_TYPES_WITH_CATEGORY: readonly string[] = [AuditEntityType.resourceItem];

/** `changes` без фин. полей, на которые у пользователя нет права. Пусто — `null`. */
export function stripHiddenFinanceFields(
  entityType: string,
  changes: unknown,
  viewer: AuditViewer,
  entity: { categoryId: string | null } = { categoryId: null },
): unknown {
  const rule = FINANCE_FIELDS[entityType];
  if (!rule || changes == null || typeof changes !== "object" || Array.isArray(changes)) {
    return changes;
  }
  if (rule.canRead(viewer, entity)) return changes;

  const hidden = new Set(rule.fields);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (hidden.has(key)) continue;
    if (key === "fields" && value && typeof value === "object" && !Array.isArray(value)) {
      const fields = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([f]) => !hidden.has(f)),
      );
      if (Object.keys(fields).length > 0) result.fields = fields;
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}
