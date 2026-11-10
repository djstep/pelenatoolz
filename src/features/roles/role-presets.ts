import {
  buildEmptyMatrix,
  buildPermissionsDocument,
  normalizePermissionMatrix,
  type PermissionMatrix,
  type PermissionSectionId,
  type SectionPermissions,
} from "@/features/roles/permissions-matrix";

/**
 * Готовые шаблоны ролей группы. Это обычные роли проекта (не системные): продюсер может их
 * переименовать, изменить или удалить. Появляются в каждом новом проекте; в существующие
 * проекты их добавила миграция 20261111140000_role_presets. Если в проекте уже есть роль с таким
 * же названием, шаблон не добавляется и та роль не меняется.
 *
 * «Смета своего цеха» — не право роли: человек становится главой цеха (выбор цеха — в приглашении).
 * Утверждение смет, настройки проекта, роли и участники — только у «Продюсера».
 */

export type RolePresetKey =
  | "director"
  | "second_director"
  | "clapper"
  | "dop"
  | "production_designer"
  | "costume_designer"
  | "makeup_artist"
  | "production_manager"
  | "line_producer";

export type RolePreset = {
  key: RolePresetKey;
  name: string;
  note: string;
  /** Правит смету своего цеха — в приглашении предлагается выбрать цех. */
  departmentHead: boolean;
  permissions: PermissionMatrix;
};

type Flags = Partial<SectionPermissions>;

const READ: Flags = { access: true, read: true };
const WRITE: Flags = { access: true, read: true, create: true, update: true, delete: true };
const FLAG: Flags = { access: true };
/** «Команда» и «Календарь»: удаления нет, правка — «Редактирование». */
const EDIT: Flags = { access: true, read: true, update: true };

function matrix(sections: Partial<Record<PermissionSectionId, Flags>>): PermissionMatrix {
  const m = buildEmptyMatrix();
  // Всем шаблонам — команда без контактов (как у любой новой роли).
  const all: Partial<Record<PermissionSectionId, Flags>> = { crew: READ, ...sections };
  for (const [id, flags] of Object.entries(all) as [PermissionSectionId, Flags][]) {
    m[id] = { ...m[id], ...flags };
  }
  return normalizePermissionMatrix(m);
}

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    key: "director",
    name: "Режиссёр-постановщик",
    note: "Правит сценарий, кастинг и пробы; видит либретто, КПП, вызывные, объекты, персонажей, календарь, команду без контактов",
    departmentHead: false,
    permissions: matrix({
      screenplay: WRITE,
      actors: WRITE,
      scenes: READ,
      schedule: READ,
      locations: READ,
      characters: READ,
      calendar: READ,
    }),
  },
  {
    key: "second_director",
    name: "2-й режиссёр",
    note: "Правит либретто, КПП, вызывные (и утверждает их), персонажей и занятость, календарь, отчёты смены; видит сценарий, кастинг, объекты, команду с контактами",
    departmentHead: false,
    permissions: matrix({
      scenes: WRITE,
      schedule: WRITE,
      callsheet_approve: FLAG,
      characters: WRITE,
      calendar: EDIT,
      reports: WRITE,
      screenplay: READ,
      actors: READ,
      locations: READ,
      crew_contacts: FLAG,
    }),
  },
  {
    key: "clapper",
    name: "Помощник режиссёра (хлопушка)",
    note: "Правит отчёты смены; видит сценарий, либретто, КПП, вызывные, календарь, команду без контактов",
    departmentHead: false,
    permissions: matrix({
      reports: WRITE,
      screenplay: READ,
      scenes: READ,
      schedule: READ,
      calendar: READ,
    }),
  },
  {
    key: "dop",
    name: "Оператор-постановщик",
    note: "Правит смету своего цеха; видит сценарий, либретто, КПП, вызывные, объекты, календарь, команду без контактов",
    departmentHead: true,
    permissions: matrix({
      screenplay: READ,
      scenes: READ,
      schedule: READ,
      locations: READ,
      calendar: READ,
    }),
  },
  {
    key: "production_designer",
    name: "Художник-постановщик",
    note: "Правит смету своего цеха, объекты и скаут; видит сценарий, либретто, КПП, вызывные, календарь, команду без контактов",
    departmentHead: true,
    permissions: matrix({
      locations: WRITE,
      screenplay: READ,
      scenes: READ,
      schedule: READ,
      calendar: READ,
    }),
  },
  {
    key: "costume_designer",
    name: "Художник по костюмам",
    note: "Правит смету своего цеха; видит сценарий, либретто, персонажей (без кастинга), КПП, вызывные, календарь, команду без контактов",
    departmentHead: true,
    permissions: matrix({
      screenplay: READ,
      scenes: READ,
      characters: READ,
      schedule: READ,
      calendar: READ,
    }),
  },
  {
    key: "makeup_artist",
    name: "Художник-гримёр",
    note: "Правит смету своего цеха; видит сценарий, либретто, персонажей (без кастинга), КПП, вызывные, календарь, команду без контактов",
    departmentHead: true,
    permissions: matrix({
      screenplay: READ,
      scenes: READ,
      characters: READ,
      schedule: READ,
      calendar: READ,
    }),
  },
  {
    key: "production_manager",
    name: "Директор картины",
    note: "Правит договоры, команду с контактами, объекты, ресурсы и их ставки, календарь; видит все сметы и план/факт, финансы, КПП, вызывные",
    departmentHead: false,
    permissions: matrix({
      contracts: WRITE,
      crew: EDIT,
      crew_contacts: FLAG,
      locations: { ...WRITE, financeRead: true, financeWrite: true },
      elements: { ...WRITE, financeRead: true, financeWrite: true },
      calendar: EDIT,
      smeta_all: READ,
      finance: { ...READ, financeRead: true },
      schedule: READ,
    }),
  },
  {
    key: "line_producer",
    name: "Линейный продюсер",
    note: "Правит договоры, начисления и платежи; видит все сметы (может вернуть главе) и всё остальное, команду с контактами; без настроек проекта и настроек сметы",
    departmentHead: false,
    permissions: matrix({
      contracts: WRITE,
      finance: { ...WRITE, financeRead: true },
      smeta_all: READ,
      smeta_return: FLAG,
      screenplay: READ,
      scenes: READ,
      schedule: READ,
      reports: READ,
      actors: { ...READ, financeRead: true },
      characters: READ,
      locations: { ...READ, financeRead: true },
      elements: { ...READ, financeRead: true },
      calendar: READ,
      crew_contacts: FLAG,
      post: READ,
    }),
  },
];

/** Документ прав шаблона — как его пишет редактор ролей (`buildPermissionsDocument`). */
export function presetPermissionsDocument(preset: RolePreset): Record<string, unknown> {
  return buildPermissionsDocument(preset.permissions, {});
}

/** Название для сравнения «такая роль уже есть»: без пробелов по краям, без регистра, ё = е. */
export function normalizeRoleNameForMatch(name: string): string {
  return name.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
}
