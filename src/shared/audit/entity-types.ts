/** Canonical audit entity types — add new modules here, not ad-hoc strings in actions. */
export const AuditEntityType = {
  project: "project",
  scene: "scene",
  shootDay: "shoot_day",
  callSheet: "call_sheet",
  character: "character",
  actor: "actor",
  castingPerson: "casting_person",
  castingCandidate: "casting_candidate",
  location: "location",
  scoutCandidate: "scout_candidate",
  resourceCategory: "resource_category",
  resourceItem: "resource_item",
  scriptVersion: "script_version",
  scriptImport: "script_import",
  budgetLine: "budget_line",
  financeOp: "finance_op",
  postTask: "post_task",
  productionReport: "production_report",
  payment: "payment",
} as const;

export type AuditEntityTypeValue =
  (typeof AuditEntityType)[keyof typeof AuditEntityType];

/** @deprecated legacy values still present in older log rows */
export const LEGACY_AUDIT_ENTITY_TYPES = [
  "ShootDay",
  "post_task",
  "finance_op",
  "budget_line",
  "casting_person",
  "script_import",
] as const;

export const auditEntityLabels: Record<string, string> = {
  [AuditEntityType.project]: "Проект",
  [AuditEntityType.scene]: "Сцена",
  [AuditEntityType.shootDay]: "Съёмочный день",
  [AuditEntityType.callSheet]: "Вызывной",
  [AuditEntityType.character]: "Персонаж",
  [AuditEntityType.actor]: "Актёр",
  [AuditEntityType.castingPerson]: "Кандидат кастинга",
  [AuditEntityType.castingCandidate]: "Заявка кастинга",
  [AuditEntityType.location]: "Локация",
  [AuditEntityType.scoutCandidate]: "Скаутинг",
  [AuditEntityType.resourceCategory]: "Категория ресурсов",
  [AuditEntityType.resourceItem]: "Элемент ресурса",
  [AuditEntityType.scriptVersion]: "Версия сценария",
  [AuditEntityType.scriptImport]: "Импорт сценария",
  [AuditEntityType.budgetLine]: "Статья сметы",
  [AuditEntityType.financeOp]: "Финансовая операция",
  [AuditEntityType.postTask]: "Пост-задача",
  [AuditEntityType.productionReport]: "Отчёт о производстве",
  [AuditEntityType.payment]: "Выплата",
  ShootDay: "Вызывной (устар.)",
};

export function auditEntityLabel(entityType: string): string {
  return auditEntityLabels[entityType] ?? entityType;
}
