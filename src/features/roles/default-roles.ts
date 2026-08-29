import {
  buildFullMatrix,
  buildViewerMatrix,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";

export const DEFAULT_ROLE_NAMES = {
  producer: "Продюсер",
  viewer: "Наблюдатель",
} as const;

export function getDefaultProjectRoles(): Array<{
  name: string;
  note: string;
  isSystem: boolean;
  permissions: PermissionMatrix;
}> {
  return [
    {
      name: DEFAULT_ROLE_NAMES.producer,
      note: "Полный доступ ко всем разделам проекта",
      isSystem: true,
      permissions: buildFullMatrix(),
    },
    {
      name: DEFAULT_ROLE_NAMES.viewer,
      note: "Только просмотр",
      isSystem: true,
      permissions: buildViewerMatrix(),
    },
  ];
}
