import { DRIVE_FOLDER_KEYS } from "@/features/cloud/lib/drive-export-rules";

/**
 * Папки и доступы на диске проекта (Google) — чистые правила: ключи папок, «кому какая папка»,
 * разница «выдано / нужно». Без базы и сети; годится и для браузера (раздел «Диск проекта»).
 * Решения 9, 10, 12, 13 и риск 9 — `docs/tasks/WAVE_3_DRIVE_NOTES.md`, п. 3.
 *
 *   PELENA · <Проект>   (root)               — никому
 *   ├── Вызывные        (callsheets)         — никому
 *   │   ├── Общая       (common)             — активные участники с «КПП и вызывные: просмотр»
 *   │   └── Цеха        (departments)        — никому
 *   │       └── <Цех>   (dept:<id>)          — главы этого цеха + активные продюсеры
 *   └── Сметы           (budgets)            — никому
 *       ├── Сводная     (budget-summary)     — активные продюсеры
 *       └── Цеха        (budget-departments) — никому
 *           └── <Цех>   (budget-dept:<id>)   — главы этого цеха + активные продюсеры
 *
 * Сметы — решения 6в, 7 и «просмотр всех папок не получает» — `docs/tasks/BUDGET_DRIVE_NOTES.md`:
 * «Финансы: просмотр» и «Сметы — просмотр всех» в доступах к папкам смет не участвуют.
 */

/** Ключи папок диска проекта (`DriveFolder.key`). */
export const PROJECT_FOLDER_KEYS = {
  ...DRIVE_FOLDER_KEYS,
  common: "common",
  departments: "departments",
} as const;

/** Ключи папок смет на диске проекта (`DriveFolder.key`); папки цехов смет — `budget-dept:<id>`. */
export const BUDGET_FOLDER_KEYS = {
  budgets: "budgets",
  summary: "budget-summary",
  departments: "budget-departments",
} as const;

export const COMMON_FOLDER_NAME = "Общая";
export const DEPARTMENTS_FOLDER_NAME = "Цеха";
export const BUDGETS_FOLDER_NAME = "Сметы";
export const BUDGET_SUMMARY_FOLDER_NAME = "Сводная";

/** Роль Google для всех выдач системы: смотреть и комментировать, не править. */
export const DRIVE_GRANT_ROLE = "commenter" as const;
/** Письмо от Google при выдаче доступа — да (решение 12; для почт не Google обязательно). */
export const DRIVE_GRANT_NOTIFY = true;

const DEPT_PREFIX = "dept:";

export function departmentFolderKey(departmentId: string) {
  return `${DEPT_PREFIX}${departmentId}`;
}

export function departmentIdFromFolderKey(key: string): string | null {
  return key.startsWith(DEPT_PREFIX) && key.length > DEPT_PREFIX.length
    ? key.slice(DEPT_PREFIX.length)
    : null;
}

const BUDGET_DEPT_PREFIX = "budget-dept:";

export function budgetDepartmentFolderKey(departmentId: string) {
  return `${BUDGET_DEPT_PREFIX}${departmentId}`;
}

export function departmentIdFromBudgetFolderKey(key: string): string | null {
  return key.startsWith(BUDGET_DEPT_PREFIX) && key.length > BUDGET_DEPT_PREFIX.length
    ? key.slice(BUDGET_DEPT_PREFIX.length)
    : null;
}

/**
 * Папка, куда может лечь файл сметы: «Сметы / Сводная» или «Сметы / Цеха / <Цех>». Смета не кладётся
 * ни в папки вызывных (их видят главы и участники без смет), ни в промежуточные папки.
 */
export function isBudgetFileFolderKey(key: string): boolean {
  return key === BUDGET_FOLDER_KEYS.summary || departmentIdFromBudgetFolderKey(key) !== null;
}

/** Последняя проверка перед загрузкой файла сметы: бросает, если папка не из конечных папок смет. */
export function assertBudgetFileFolderKey(key: string): void {
  if (!isBudgetFileFolderKey(key)) {
    throw new Error(`Смета не кладётся в папку «${key}»: только «Сметы / Сводная» и папки цехов смет`);
  }
}

/**
 * Риск 9: в «Моём диске» доступ к папке наследуют все вложенные, снять его у вложенной нельзя.
 * Поэтому доступ выдаётся только конечным папкам — «Общая», папки цехов вызывных, «Сводная» и
 * папки цехов смет. Никогда `root` / `callsheets` / `departments` / `budgets` / `budget-departments`
 * (и любым будущим ключам, пока их не добавят сюда).
 */
export function isShareableFolderKey(key: string): boolean {
  return (
    key === PROJECT_FOLDER_KEYS.common ||
    departmentIdFromFolderKey(key) !== null ||
    isBudgetFileFolderKey(key)
  );
}

export class UnshareableFolderError extends Error {
  constructor(key: string) {
    super(`Доступ к папке «${key}» не выдаётся: только конечные папки вызывных и смет`);
    this.name = "UnshareableFolderError";
  }
}

/** Последняя проверка перед запросом к Google: бросает, если папка не конечная. */
export function assertShareableFolderKey(key: string): void {
  if (!isShareableFolderKey(key)) throw new UnshareableFolderError(key);
}

/** Почта, на которую выдаётся доступ: «Почта для Google», иначе почта входа (решение 13). */
export function grantEmailFor(user: { email: string; googleEmail: string | null }): string {
  return (user.googleEmail?.trim() || user.email).trim().toLowerCase();
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---------- кому какая папка ----------

export type AccessMember = {
  userId: string;
  membershipId: string;
  status: "ACTIVE" | "INVITED" | "REMOVED";
  isProducer: boolean;
  /** «КПП и вызывные: просмотр» у роли. */
  canReadCallSheets: boolean;
  email: string;
  googleEmail: string | null;
};

export type AccessFolder = {
  id: string;
  key: string;
  /** У папки цеха — id цеха; цех удалили — пусто. */
  departmentId: string | null;
};

export type DesiredGrant = { folderId: string; userId: string; email: string };

/**
 * Кому какая папка. Только активные участники (приглашённые и удалённые — ничего). Аккаунт самого
 * диска пропускается — он владелец папок. Одна почта на папку — один доступ (у Google доступ
 * человека к файлу один): второй человек с той же почтой не получает своей выдачи.
 * Папки `root` / `callsheets` / `departments` / `budgets` / `budget-departments` в ответ не
 * попадают никогда. Папки смет: «Сводная» — продюсеры, цех — главы цеха и продюсеры (финансовые
 * права и «Сметы — просмотр всех» не участвуют — решения 6в и 7, `BUDGET_DRIVE_NOTES.md`).
 */
export function desiredFolderGrants(input: {
  folders: readonly AccessFolder[];
  members: readonly AccessMember[];
  /** Главы цехов: участие → цех. Цех, которого уже нет, сюда не попадает. */
  departmentHeads: readonly { departmentId: string; membershipId: string }[];
  /** Почта аккаунта диска проекта (хранитель или служебный аккаунт). */
  driveAccountEmail: string | null;
}): DesiredGrant[] {
  const active = input.members
    .filter((m) => m.status === "ACTIVE")
    .map((m) => ({ ...m, grantEmail: grantEmailFor(m) }))
    .filter((m) => !sameEmail(m.grantEmail, input.driveAccountEmail))
    .sort((a, b) => a.userId.localeCompare(b.userId));

  const out: DesiredGrant[] = [];
  for (const folder of input.folders) {
    if (!isShareableFolderKey(folder.key)) continue;
    let who: typeof active;
    if (folder.key === PROJECT_FOLDER_KEYS.common) {
      who = active.filter((m) => m.canReadCallSheets);
    } else if (folder.key === BUDGET_FOLDER_KEYS.summary) {
      who = active.filter((m) => m.isProducer);
    } else {
      const departmentId =
        departmentIdFromFolderKey(folder.key) ?? departmentIdFromBudgetFolderKey(folder.key);
      // Цех удалили (`departmentId` обнулился) — папка остаётся, доступов нет.
      if (!departmentId || folder.departmentId !== departmentId) continue;
      const heads = new Set(
        input.departmentHeads.filter((h) => h.departmentId === departmentId).map((h) => h.membershipId),
      );
      who = active.filter((m) => m.isProducer || heads.has(m.membershipId));
    }
    const emails = new Set<string>();
    for (const m of who) {
      if (emails.has(m.grantEmail)) continue;
      emails.add(m.grantEmail);
      out.push({ folderId: folder.id, userId: m.userId, email: m.grantEmail });
    }
  }
  return out;
}

// ---------- разница «выдано / нужно» ----------

/** Выдача системы, как она записана в базе (`DriveFolderGrant`). */
export type StoredGrant = {
  id: string;
  folderId: string;
  userId: string;
  email: string;
  permissionId: string | null;
  status: "OK" | "PENDING_ADD" | "PENDING_REMOVE" | "FAILED";
};

/** Доступ к папке, как его показывает Google (`permissions.list`): и наши, и выданные руками. */
export type FolderPermission = { id: string; email: string | null };

export type GrantOp =
  /** Выдать: строки нет — создать; есть без `permissionId` — повторить. */
  | { kind: "add"; folderId: string; userId: string; email: string; grantId: string | null }
  /** Почта сменилась: снять старую выдачу (если она ещё есть у Google) и выдать на новую. */
  | {
      kind: "regrant";
      grantId: string;
      folderId: string;
      userId: string;
      email: string;
      oldPermissionId: string | null;
    }
  /** Снять выдачу системы у Google и удалить строку. */
  | { kind: "remove"; grantId: string; folderId: string; permissionId: string }
  /** Удалить строку без запроса к Google (у Google этой выдачи уже нет / её и не было). */
  | { kind: "drop"; grantId: string }
  /** Выдача на месте — пометить «синхронизировано». */
  | { kind: "markOk"; grantId: string };

/**
 * Что сделать, чтобы выдачи системы стали такими, как нужно. Трогаются только выдачи системы
 * (строки `DriveFolderGrant` с их `permissionId`); доступы, выданные руками, — никогда.
 * `google` — доступы папок от Google (папка → список); папки нет в карте — Google не спрашивали,
 * строкам базы верим как есть.
 * - строка есть, у Google её выдачи нет (сняли руками, гонка) — выдать заново;
 * - нужному человеку уже выдано руками (почта есть у Google, выдача не наша) — ничего не делать;
 * - одну и ту же выдачу (`permissionId`) держит ещё нужная строка — у Google не снимать.
 */
export function diffFolderGrants(input: {
  desired: readonly DesiredGrant[];
  stored: readonly StoredGrant[];
  google?: ReadonlyMap<string, readonly FolderPermission[]>;
}): GrantOp[] {
  const ops: GrantOp[] = [];
  const pairKey = (folderId: string, userId: string) => `${folderId}\u0000${userId}`;
  const storedByPair = new Map(input.stored.map((g) => [pairKey(g.folderId, g.userId), g]));
  const desiredPairs = new Set(input.desired.map((d) => pairKey(d.folderId, d.userId)));

  const googleIds = (folderId: string) => {
    const list = input.google?.get(folderId);
    return list ? new Set(list.map((p) => p.id)) : null;
  };
  /** Почта уже есть у Google доступом, которого система не выдавала (выдан руками). */
  const manualEmail = (folderId: string, email: string) => {
    const list = input.google?.get(folderId);
    if (!list) return false;
    const ours = new Set(
      input.stored.filter((g) => g.folderId === folderId && g.permissionId).map((g) => g.permissionId),
    );
    return list.some((p) => !ours.has(p.id) && sameEmail(p.email, email));
  };

  // Выдачи, которые останутся у нужных строк, — их нельзя снимать при удалении лишних строк.
  const keptPermissions = new Set<string>();
  for (const d of input.desired) {
    const row = storedByPair.get(pairKey(d.folderId, d.userId));
    if (row?.permissionId && sameEmail(row.email, d.email)) {
      keptPermissions.add(`${d.folderId}\u0000${row.permissionId}`);
    }
  }

  for (const d of input.desired) {
    const row = storedByPair.get(pairKey(d.folderId, d.userId));
    const live = googleIds(d.folderId);
    if (row?.permissionId) {
      const stillThere = !live || live.has(row.permissionId);
      if (sameEmail(row.email, d.email)) {
        if (stillThere) {
          if (row.status !== "OK") ops.push({ kind: "markOk", grantId: row.id });
        } else {
          ops.push({ kind: "add", folderId: d.folderId, userId: d.userId, email: d.email, grantId: row.id });
        }
      } else {
        // Старую выдачу снимаем, только если она ещё есть и её не держит другая нужная строка.
        const oldPermissionId =
          stillThere && !keptPermissions.has(`${d.folderId}\u0000${row.permissionId}`)
            ? row.permissionId
            : null;
        if (manualEmail(d.folderId, d.email)) {
          ops.push(
            oldPermissionId
              ? { kind: "remove", grantId: row.id, folderId: d.folderId, permissionId: oldPermissionId }
              : { kind: "drop", grantId: row.id },
          );
        } else {
          ops.push({
            kind: "regrant",
            grantId: row.id,
            folderId: d.folderId,
            userId: d.userId,
            email: d.email,
            oldPermissionId,
          });
        }
      }
      continue;
    }
    if (manualEmail(d.folderId, d.email)) {
      // Доступ уже выдан руками: своего не выдаём (иначе потом сняли бы чужой).
      if (row) ops.push({ kind: "drop", grantId: row.id });
      continue;
    }
    ops.push({ kind: "add", folderId: d.folderId, userId: d.userId, email: d.email, grantId: row?.id ?? null });
  }

  for (const row of input.stored) {
    if (desiredPairs.has(pairKey(row.folderId, row.userId))) continue;
    const live = googleIds(row.folderId);
    if (
      row.permissionId &&
      (!live || live.has(row.permissionId)) &&
      !keptPermissions.has(`${row.folderId}\u0000${row.permissionId}`)
    ) {
      ops.push({ kind: "remove", grantId: row.id, folderId: row.folderId, permissionId: row.permissionId });
    } else {
      ops.push({ kind: "drop", grantId: row.id });
    }
  }
  return ops;
}

/** Ничего делать не нужно — выдачи совпадают с нужными. */
export function grantsInSync(ops: readonly GrantOp[]) {
  return ops.length === 0;
}

// ---------- почта и подсказки ----------

const GOOGLE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Почта точно Google-аккаунт: Gmail или совпадает с проверенной почтой подключённого Google
 * человека. Иначе — пометка «почта не Google» (открыть папку можно, только создав Google-аккаунт
 * на эту почту; у компаний на Google Workspace пометка может быть лишней).
 */
export function isKnownGoogleEmail(email: string, verifiedGoogleEmails: readonly (string | null)[]) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return GOOGLE_MAIL_DOMAINS.has(domain) || verifiedGoogleEmails.some((v) => sameEmail(v, email));
}

/**
 * «Профиль»: на какую почту будет выдан доступ к папкам и не расходится ли она с подключённым
 * личным Google (риск 4 — опечатка уведёт вызывной с телефонами постороннему).
 */
export function profileDriveEmailNotice(input: {
  email: string;
  googleEmail: string | null;
  connectedGoogleEmail: string | null;
}): { grantEmail: string; mismatch: string | null } {
  const grantEmail = grantEmailFor(input);
  const mismatch =
    input.connectedGoogleEmail && !sameEmail(input.connectedGoogleEmail, grantEmail)
      ? input.connectedGoogleEmail.trim().toLowerCase()
      : null;
  return { grantEmail, mismatch };
}
