export const PERMISSION_SECTIONS = [
  { id: "scenes", label: "Сцены (либретто)" },
  { id: "script_import", label: "Импорт сценария" },
  { id: "schedule", label: "КПП и вызывные" },
  { id: "post_edit_timing", label: "Хронометраж монтажа" },
  { id: "actors", label: "Актёры" },
  { id: "characters", label: "Персонажи" },
  { id: "locations", label: "Объекты и места" },
  { id: "elements", label: "Прочие ресурсы" },
  { id: "budget", label: "Смета" },
  { id: "reports", label: "Производственные отчёты" },
  { id: "finance", label: "Финансы" },
  { id: "post", label: "Постпродакшн" },
  { id: "members", label: "Участники и роли" },
  { id: "project_settings", label: "Настройки проекта" },
] as const;

export type PermissionSectionId = (typeof PERMISSION_SECTIONS)[number]["id"];

export type SectionPermissions = {
  access: boolean;
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  financeRead: boolean;
  financeWrite: boolean;
};

export type PermissionMatrix = Record<PermissionSectionId, SectionPermissions>;

export const PERMISSION_FLAGS = [
  "access",
  "read",
  "create",
  "update",
  "delete",
  "financeRead",
  "financeWrite",
] as const;

export function emptySectionPermissions(): SectionPermissions {
  return {
    access: false,
    read: false,
    create: false,
    update: false,
    delete: false,
    financeRead: false,
    financeWrite: false,
  };
}

export function fullSectionPermissions(): SectionPermissions {
  return {
    access: true,
    read: true,
    create: true,
    update: true,
    delete: true,
    financeRead: true,
    financeWrite: true,
  };
}

export function buildEmptyMatrix(): PermissionMatrix {
  return Object.fromEntries(
    PERMISSION_SECTIONS.map((s) => [s.id, emptySectionPermissions()]),
  ) as PermissionMatrix;
}

export function buildFullMatrix(): PermissionMatrix {
  return Object.fromEntries(
    PERMISSION_SECTIONS.map((s) => [s.id, fullSectionPermissions()]),
  ) as PermissionMatrix;
}

export function buildViewerMatrix(): PermissionMatrix {
  const matrix = buildEmptyMatrix();
  for (const section of PERMISSION_SECTIONS) {
    matrix[section.id] = {
      ...emptySectionPermissions(),
      access: true,
      read: true,
      financeRead: ["budget", "finance", "actors"].includes(section.id),
    };
  }
  return matrix;
}

export function parsePermissionMatrix(raw: unknown): PermissionMatrix {
  const base = buildEmptyMatrix();
  if (!raw || typeof raw !== "object") return base;
  for (const section of PERMISSION_SECTIONS) {
    const value = (raw as Record<string, unknown>)[section.id];
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    base[section.id] = {
      access: Boolean(v.access),
      read: Boolean(v.read),
      create: Boolean(v.create),
      update: Boolean(v.update),
      delete: Boolean(v.delete),
      financeRead: Boolean(v.financeRead),
      financeWrite: Boolean(v.financeWrite),
    };
  }
  return base;
}

export function hasSectionPermission(
  matrix: PermissionMatrix,
  section: PermissionSectionId,
  flag: keyof SectionPermissions,
): boolean {
  return Boolean(matrix[section]?.[flag]);
}

/** Backward-compatible check used across modules */
export function can(
  matrix: PermissionMatrix,
  section: PermissionSectionId,
  action: "read" | "write" | "manage" | "finance",
): boolean {
  const s = matrix[section];
  if (!s?.access) return false;
  switch (action) {
    case "read":
      return s.read;
    case "write":
      return s.create || s.update || s.delete;
    case "manage":
      return s.update && s.delete;
    case "finance":
      return s.financeRead || s.financeWrite;
    default:
      return false;
  }
}
