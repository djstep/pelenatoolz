"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams, usePathname } from "next/navigation";
import type { CloudProvider } from "@prisma/client";
import {
  exportCallSheetToDriveAction,
  getCallSheetDriveStateAction,
  type CallSheetDriveState,
} from "@/features/call-sheets/drive-actions";
import { CloudReconnectNotice } from "@/features/cloud/components/cloud-file-picker";
import {
  DRIVE_STATUS_LABELS,
  YANDEX_PERSONAL_NOTE,
} from "@/features/cloud/lib/drive-export-rules";
import type { DriveExportView } from "@/features/cloud/lib/drive-export-service";
import { cloudProviderLabels } from "@/features/cloud/lib/types";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

const CURRENT = "current";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Ссылка для показа: кириллица в пути Яндекса — буквами, а не %D0%9F…; копируется исходная. */
function displayUrl(url: string) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

function linkLabel(provider: CloudProvider) {
  return provider === "GOOGLE_DRIVE" ? "Открыть Google Таблицу" : "Открыть папку на Яндекс Диске";
}

/** «уже на диске: ссылка, кто, когда, версия N (статус)». */
function ExistingExport({ view }: { view: DriveExportView }) {
  return (
    <p className="text-[var(--muted-fg)]" data-testid="drive-export-existing">
      Уже на диске:{" "}
      {view.webUrl ? (
        <a
          href={view.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          {linkLabel(view.provider)}
        </a>
      ) : (
        "файл"
      )}
      {" · "}
      {[
        view.uploadedByName,
        formatWhen(view.uploadedAt),
        `${view.version ? `версия ${view.version} ` : ""}(${view.statusLabel})`,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

/** Назначение в окне: свой диск (`personal:<провайдер>`), «Общая» или папка цеха на диске проекта. */
type Destination = `personal:${CloudProvider}` | "common" | "department";

function personalDestination(provider: CloudProvider): Destination {
  return `personal:${provider}`;
}

function personalProvider(dest: Destination | null): CloudProvider | null {
  return dest?.startsWith("personal:") ? (dest.slice("personal:".length) as CloudProvider) : null;
}

/** Первое доступное назначение: свой подключённый диск, затем «Общая», затем папка цеха. */
function firstDestination(state: CallSheetDriveState): Destination | null {
  const usable = state.connections.find((c) => !c.reconnectReason);
  if (usable) return personalDestination(usable.provider);
  const drive = state.projectDrive;
  if (!drive || drive.unavailable) return null;
  if (drive.common) return "common";
  return drive.departments.length > 0 ? "department" : null;
}

/** Ключ папки диска проекта (`DriveFolder.key`) — как у сервера: `common` / `dept:<id>`. */
function projectKeyOf(dest: Destination | null, departmentId: string | null): string | null {
  if (dest === "common") return "common";
  if (dest === "department" && departmentId) return `dept:${departmentId}`;
  return null;
}

/**
 * «Экспорт → На диск»: вызывной на свой личный Google Диск (Google Таблица) или Яндекс Диск
 * (.xlsx), в «Общую» или папку цеха на диске проекта (Google Таблица). Назначения — только те,
 * что доступны человеку (их считает сервер); личные — только подключённые без «переподключите».
 * Версия — по умолчанию утверждённая (у утверждённого) или текущая с меткой. Права и всё
 * остальное проверяет сервер. Монтируется при открытии: каждое открытие — с чистого листа.
 */
export function CallSheetDriveExportModal({
  open,
  onClose,
  projectId,
  dayId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  dayId: string;
}) {
  const toast = useToast();
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const [state, setState] = useState<CallSheetDriveState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dest, setDest] = useState<Destination | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [version, setVersion] = useState<string>(CURRENT);
  const [done, setDone] = useState<{ message: string; view: DriveExportView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function applyState(next: CallSheetDriveState) {
    setState(next);
    setDest(firstDestination(next));
    setDepartmentId((prev) =>
      next.projectDrive?.departments.some((d) => d.id === prev)
        ? prev
        : (next.projectDrive?.departments[0]?.id ?? null),
    );
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getCallSheetDriveStateAction(projectId, dayId).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setLoadError(res.error);
        return;
      }
      applyState(res);
      setVersion(res.defaultVersion ? String(res.defaultVersion) : CURRENT);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, dayId]);

  const usable = state?.connections.filter((c) => !c.reconnectReason) ?? [];
  const drive = state?.projectDrive ?? null;
  const driveReady = drive != null && !drive.unavailable;
  const provider = personalProvider(dest);
  const projectKey = projectKeyOf(dest, departmentId);
  const department = drive?.departments.find((d) => d.id === departmentId) ?? null;
  const existing = provider
    ? (state?.exports.find((e) => e.provider === provider) ?? null)
    : (state?.projectExports.find((e) => e.key === projectKey)?.view ?? null);
  const approved = state?.sheet?.status === "APPROVED";
  const canUpload = provider != null || (driveReady && projectKey != null);

  function choose(next: Destination) {
    setDest(next);
    setDone(null);
    setError(null);
  }

  function upload() {
    if (!canUpload) return;
    setError(null);
    setDone(null);
    setCopied(false);
    const versionValue = version === CURRENT ? null : Number(version);
    const input = provider
      ? { destination: "personal", provider, version: versionValue }
      : dest === "common"
        ? { destination: "common", version: versionValue }
        : { destination: "department", departmentId, version: versionValue };
    startTransition(async () => {
      const res = await exportCallSheetToDriveAction(projectId, dayId, input);
      if ("error" in res) {
        setError(res.error);
        if (res.reconnect || res.projectDrive) {
          // Подключение помечено «переподключите» или диск проекта недоступен — обновить окно.
          const fresh = await getCallSheetDriveStateAction(projectId, dayId);
          if (!("error" in fresh)) applyState(fresh);
        }
        return;
      }
      setDone({ message: res.message, view: res.export });
      toast.success(res.message);
      const key = res.projectKey;
      setState((prev) => {
        if (!prev) return prev;
        if (key) {
          return {
            ...prev,
            projectExports: [...prev.projectExports.filter((e) => e.key !== key), { key, view: res.export }],
          };
        }
        return { ...prev, exports: [...prev.exports.filter((e) => e.provider !== res.export.provider), res.export] };
      });
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error("Не удалось скопировать — выделите ссылку вручную");
    }
  }

  const locale = params.locale ?? "ru";
  const profileHref = `/${locale}/profile`;
  const settingsHref = `/${locale}/projects/${projectId}/settings`;
  const hasAnyDestination = usable.length > 0 || driveReady;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Вызывной на диск"
      footer={
        <div className="flex gap-2">
          {hasAnyDestination ? (
            <Button type="button" disabled={pending || !canUpload} onClick={upload}>
              {pending ? "Выгрузка…" : existing ? "Выгрузить и заменить" : "Выгрузить"}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm" data-testid="drive-export-modal">
        {loadError ? <p className="text-[var(--danger)]">{loadError}</p> : null}
        {!state && !loadError ? <p className="text-[var(--muted-fg)]">Загрузка…</p> : null}

        {state ? (
          <>
            <CloudReconnectNotice connections={state.connections} returnTo={pathname} />

            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">Куда</legend>
              {usable.map((c) => (
                <label key={c.provider} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="drive-destination"
                    value={personalDestination(c.provider)}
                    checked={dest === personalDestination(c.provider)}
                    onChange={() => choose(personalDestination(c.provider))}
                  />
                  <span>
                    Мой {cloudProviderLabels[c.provider]}
                    {c.accountEmail ? (
                      <span className="text-[var(--muted-fg)]"> · {c.accountEmail}</span>
                    ) : null}
                  </span>
                </label>
              ))}
              {usable.length === 0 ? (
                <p className="text-[var(--muted-fg)]">
                  {state.connections.length === 0 ? "Личный диск не подключён. " : null}
                  Подключите Google Диск или Яндекс Диск в{" "}
                  <a href={profileHref} className="text-[var(--accent)] hover:underline">
                    Профиле
                  </a>
                  .
                </p>
              ) : null}

              {drive && driveReady ? (
                <>
                  {drive.common ? (
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="drive-destination"
                        value="common"
                        className="mt-1"
                        checked={dest === "common"}
                        onChange={() => choose("common")}
                      />
                      <span>
                        Диск проекта — Общая
                        <span className="block text-[var(--muted-fg)]" data-testid="drive-export-audience-common">
                          Кто увидит: {drive.common.audience}
                        </span>
                      </span>
                    </label>
                  ) : null}
                  {drive.departments.length > 0 ? (
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="drive-destination"
                        value="department"
                        className="mt-1"
                        checked={dest === "department"}
                        onChange={() => choose("department")}
                      />
                      <span>
                        Диск проекта — папка цеха
                        {dest !== "department" && department ? (
                          <span className="text-[var(--muted-fg)]"> · {department.name}</span>
                        ) : null}
                      </span>
                    </label>
                  ) : null}
                  {dest === "department" && department ? (
                    <div className="space-y-1 pl-6">
                      <Label htmlFor="drive-export-department">Цех</Label>
                      <Select
                        id="drive-export-department"
                        value={department.id}
                        onChange={(e) => {
                          setDepartmentId(e.target.value);
                          setDone(null);
                          setError(null);
                        }}
                      >
                        {drive.departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                      <p className="text-[var(--muted-fg)]" data-testid="drive-export-audience-department">
                        Кто увидит: {department.audience}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}

              {drive?.notice ? (
                <p
                  className="rounded-lg border border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] px-3 py-2 text-[var(--tone-warning-soft)]"
                  data-testid="drive-export-project-unavailable"
                >
                  {drive.notice}
                  {drive.canOpenSettings ? (
                    <>
                      {" "}
                      <a href={settingsHref} className="font-medium underline underline-offset-2">
                        Открыть настройки проекта
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </fieldset>

            {hasAnyDestination ? (
              <>
                <div>
                  <Label htmlFor="drive-export-version">Версия</Label>
                  <Select
                    id="drive-export-version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                  >
                    {!approved ? (
                      <option value={CURRENT}>
                        {`Текущая — ${DRIVE_STATUS_LABELS[state.sheet?.status ?? "DRAFT"]}${
                          state.sheet ? `, версия ${state.sheet.version}` : ""
                        }`}
                      </option>
                    ) : null}
                    {state.versions.map((v) => (
                      <option key={v.version} value={String(v.version)}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <p className="text-[var(--muted-fg)]">
                  {provider === "YANDEX_DISK"
                    ? "Файл .xlsx — в папке приложения «<Проект> · <код проекта>/Вызывные»."
                    : dest === "common"
                      ? "Google Таблица — в папке «PELENA · <Проект>/Вызывные/Общая» на диске проекта."
                      : dest === "department"
                        ? `Google Таблица — в папке «PELENA · <Проект>/Вызывные/Цеха/${department?.name ?? "<Цех>"}» на диске проекта.`
                        : "Google Таблица — в папке «PELENA · <Проект>/Вызывные» на вашем диске."}{" "}
                  Повторная выгрузка заменяет тот же файл.
                </p>
                {provider === "YANDEX_DISK" ? (
                  <p className="rounded-lg border border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] px-3 py-2 text-[var(--tone-warning-soft)]">
                    {YANDEX_PERSONAL_NOTE}
                  </p>
                ) : null}

                {existing && !done ? <ExistingExport view={existing} /> : null}
              </>
            ) : null}

            {error ? (
              <p role="alert" className="text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            {done ? (
              <div
                role="status"
                className="space-y-2 rounded-xl border border-[var(--border)] px-3 py-2"
                data-testid="drive-export-done"
              >
                <p>{done.message}</p>
                {done.view.webUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={done.view.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-[var(--accent)] hover:underline"
                    >
                      {displayUrl(done.view.webUrl)}
                    </a>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void copyLink(done.view.webUrl!)}
                    >
                      {copied ? "Скопировано" : "Копировать ссылку"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
