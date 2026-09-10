"use client";

import {
  ENTITY_FINANCE_SECTIONS,
  PERMISSION_FLAGS,
  PERMISSION_SECTIONS,
  resolveCategoryFinance,
  type CategoryFinancePermissions,
  type PermissionMatrix,
  type SectionPermissions,
} from "@/features/roles/permissions-matrix";

const FLAG_LABELS: Record<keyof SectionPermissions, string> = {
  access: "Доступ",
  read: "Просмотр",
  create: "Создание",
  update: "Редактирование",
  delete: "Удаление",
  financeRead: "Фин. условия: просмотр",
  financeWrite: "Фин. условия: редактирование",
  financeUnlock: "Снятие фиксации платежей",
};

const MAIN_FLAGS = PERMISSION_FLAGS.filter(
  (f) => f !== "financeRead" && f !== "financeWrite",
);

export type ResourceCategoryOption = {
  id: string;
  name: string;
};

export function PermissionMatrixEditor({
  matrix,
  categoryFinance = {},
  resourceCategories = [],
  prefix = "perm",
}: {
  matrix: PermissionMatrix;
  categoryFinance?: Record<string, CategoryFinancePermissions>;
  resourceCategories?: ResourceCategoryOption[];
  prefix?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
              <th className="py-2 pr-3 font-medium">Раздел</th>
              {MAIN_FLAGS.map((flag) => (
                <th key={flag} className="px-1 py-2 text-center font-medium">
                  {FLAG_LABELS[flag]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_SECTIONS.map((section) => (
              <tr
                key={section.id}
                className="border-b border-[var(--border)]/50"
              >
                <td className="py-2 pr-3 font-medium">{section.label}</td>
                {MAIN_FLAGS.map((flag) => (
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

      <div>
        <h4 className="mb-1 text-sm font-semibold">
          Финансовые условия по типам ресурсов
        </h4>
        <p className="mb-3 text-xs text-[var(--muted-fg)]">
          Просмотр и редактирование ставок настраиваются отдельно: актёры,
          локации и каждая категория из раздела «Ресурсы». Модуль «Финансы /
          Смета» — в блоке ниже.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 pr-3 font-medium">Тип</th>
                <th className="px-2 py-2 text-center font-medium">
                  {FLAG_LABELS.financeRead}
                </th>
                <th className="px-2 py-2 text-center font-medium">
                  {FLAG_LABELS.financeWrite}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--border)]/50">
                <td className="py-2 pr-3 font-medium">Актёры</td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_actors_financeRead`}
                    defaultChecked={matrix.actors.financeRead}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_actors_financeWrite`}
                    defaultChecked={matrix.actors.financeWrite}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]/50">
                <td className="py-2 pr-3 font-medium">Локации</td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_locations_financeRead`}
                    defaultChecked={matrix.locations.financeRead}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_locations_financeWrite`}
                    defaultChecked={matrix.locations.financeWrite}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]/50 bg-white/[0.02]">
                <td className="py-2 pr-3 font-medium">
                  Новые категории ресурсов
                  <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted-fg)]">
                    По умолчанию, если для категории нет своей строки
                  </span>
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_elements_financeRead`}
                    defaultChecked={matrix.elements.financeRead}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    name={`${prefix}_elements_financeWrite`}
                    defaultChecked={matrix.elements.financeWrite}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
              </tr>
              {resourceCategories.map((cat) => {
                const resolved = resolveCategoryFinance(
                  matrix,
                  categoryFinance,
                  cat.id,
                );
                return (
                  <tr
                    key={cat.id}
                    className="border-b border-[var(--border)]/50"
                  >
                    <td className="py-2 pr-3 font-medium">{cat.name}</td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        name={`catfin_${cat.id}_financeRead`}
                        defaultChecked={resolved.financeRead}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        name={`catfin_${cat.id}_financeWrite`}
                        defaultChecked={resolved.financeWrite}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">
          Финансы модуля (смета / касса)
        </h4>
        <p className="mb-3 text-xs text-[var(--muted-fg)]">
          Отдельно от ставок актёров и ресурсов — доступ к смете, начислениям и
          платежам.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 pr-3 font-medium">Раздел</th>
                <th className="px-2 py-2 text-center font-medium">
                  {FLAG_LABELS.financeRead}
                </th>
                <th className="px-2 py-2 text-center font-medium">
                  {FLAG_LABELS.financeWrite}
                </th>
                <th className="px-2 py-2 text-center font-medium">
                  {FLAG_LABELS.financeUnlock}
                </th>
              </tr>
            </thead>
            <tbody>
              {(["budget", "finance"] as const).map((sectionId) => {
                const section = PERMISSION_SECTIONS.find(
                  (s) => s.id === sectionId,
                )!;
                return (
                  <tr
                    key={sectionId}
                    className="border-b border-[var(--border)]/50"
                  >
                    <td className="py-2 pr-3 font-medium">{section.label}</td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        name={`${prefix}_${sectionId}_financeRead`}
                        defaultChecked={matrix[sectionId].financeRead}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        name={`${prefix}_${sectionId}_financeWrite`}
                        defaultChecked={matrix[sectionId].financeWrite}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      {sectionId === "finance" ? (
                        <input
                          type="checkbox"
                          name={`${prefix}_${sectionId}_financeUnlock`}
                          defaultChecked={matrix[sectionId].financeUnlock}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      ) : (
                        <span className="text-[var(--muted-fg)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preserve finance flags for non-entity sections that are not budget/finance */}
      {PERMISSION_SECTIONS.filter(
        (s) =>
          !ENTITY_FINANCE_SECTIONS.includes(s.id) &&
          s.id !== "budget" &&
          s.id !== "finance",
      ).map((section) => (
        <div key={section.id} className="hidden">
          <input
            type="checkbox"
            name={`${prefix}_${section.id}_financeRead`}
            defaultChecked={matrix[section.id].financeRead}
          />
          <input
            type="checkbox"
            name={`${prefix}_${section.id}_financeWrite`}
            defaultChecked={matrix[section.id].financeWrite}
          />
          <input
            type="checkbox"
            name={`${prefix}_${section.id}_financeUnlock`}
            defaultChecked={matrix[section.id].financeUnlock}
          />
        </div>
      ))}
    </div>
  );
}
