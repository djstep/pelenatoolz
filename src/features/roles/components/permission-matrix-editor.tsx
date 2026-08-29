"use client";

import {
  PERMISSION_FLAGS,
  PERMISSION_SECTIONS,
  type PermissionMatrix,
  type SectionPermissions,
} from "@/features/roles/permissions-matrix";

const FLAG_LABELS: Record<keyof SectionPermissions, string> = {
  access: "Доступ",
  read: "Просмотр",
  create: "Создание",
  update: "Редактирование",
  delete: "Удаление",
  financeRead: "Фин. просмотр",
  financeWrite: "Фин. редактирование",
};

export function PermissionMatrixEditor({
  matrix,
  prefix = "perm",
}: {
  matrix: PermissionMatrix;
  prefix?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-2 pr-3 font-medium">Раздел</th>
            {PERMISSION_FLAGS.map((flag) => (
              <th key={flag} className="px-1 py-2 font-medium text-center">
                {FLAG_LABELS[flag]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_SECTIONS.map((section) => (
            <tr key={section.id} className="border-b border-[var(--border)]/50">
              <td className="py-2 pr-3 font-medium">{section.label}</td>
              {PERMISSION_FLAGS.map((flag) => (
                <td key={flag} className="px-1 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_${section.id}_${flag}`}
                    defaultChecked={matrix[section.id][flag]}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
