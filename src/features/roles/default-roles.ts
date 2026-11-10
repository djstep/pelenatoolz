import {
  buildFullMatrix,
  buildViewerMatrix,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";
import { ROLE_PRESETS } from "@/features/roles/role-presets";

export const DEFAULT_ROLE_NAMES = {
  producer: "Продюсер",
  viewer: "Наблюдатель",
} as const;

/**
 * Роли нового проекта: системные «Продюсер» и «Наблюдатель» и шаблоны ролей группы
 * (обычные роли с ключом шаблона, см. role-presets.ts).
 */
export function getDefaultProjectRoles(): Array<{
  name: string;
  note: string;
  isSystem: boolean;
  permissions: PermissionMatrix;
  presetKey: string | null;
}> {
  return [
    {
      name: DEFAULT_ROLE_NAMES.producer,
      note: "Полный доступ ко всем разделам проекта",
      isSystem: true,
      permissions: buildFullMatrix(),
      presetKey: null,
    },
    {
      name: DEFAULT_ROLE_NAMES.viewer,
      note: "Только просмотр",
      isSystem: true,
      permissions: buildViewerMatrix(),
      presetKey: null,
    },
    ...ROLE_PRESETS.map((preset) => ({
      name: preset.name,
      note: preset.note,
      isSystem: false,
      permissions: preset.permissions,
      presetKey: preset.key,
    })),
  ];
}
