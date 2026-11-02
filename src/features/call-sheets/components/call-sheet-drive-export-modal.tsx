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

/**
 * «Экспорт → На диск»: вызывной на свой личный Google Диск (Google Таблица) или Яндекс Диск
 * (.xlsx). Выбор диска — только подключённые без «переподключите»; версия — по умолчанию
 * утверждённая (у утверждённого) или текущая с меткой. Права и всё остальное проверяет сервер.
 * Монтируется при открытии: каждое открытие — с чистого листа и свежим состоянием с сервера.
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
  const [provider, setProvider] = useState<CloudProvider | null>(null);
  const [version, setVersion] = useState<string>(CURRENT);
  const [done, setDone] = useState<{ message: string; view: DriveExportView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getCallSheetDriveStateAction(projectId, dayId).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setLoadError(res.error);
        return;
      }
      setState(res);
      setProvider(res.connections.find((c) => !c.reconnectReason)?.provider ?? null);
      setVersion(res.defaultVersion ? String(res.defaultVersion) : CURRENT);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, dayId]);

  const usable = state?.connections.filter((c) => !c.reconnectReason) ?? [];
  const existing = state?.exports.find((e) => e.provider === provider) ?? null;
  const approved = state?.sheet?.status === "APPROVED";

  function upload() {
    if (!provider) return;
    setError(null);
    setDone(null);
    setCopied(false);
    startTransition(async () => {
      const res = await exportCallSheetToDriveAction(projectId, dayId, {
        provider,
        version: version === CURRENT ? null : Number(version),
      });
      if ("error" in res) {
        setError(res.error);
        if (res.reconnect) {
          // Подключение помечено «переподключите» — обновить окно, чтобы показать плашку.
          const fresh = await getCallSheetDriveStateAction(projectId, dayId);
          if (!("error" in fresh)) {
            setState(fresh);
            setProvider(fresh.connections.find((c) => !c.reconnectReason)?.provider ?? null);
          }
        }
        return;
      }
      setDone({ message: res.message, view: res.export });
      toast.success(res.message);
      setState((prev) =>
        prev
          ? { ...prev, exports: [...prev.exports.filter((e) => e.provider !== res.export.provider), res.export] }
          : prev,
      );
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

  const profileHref = `/${params.locale ?? "ru"}/profile`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Вызывной на диск"
      footer={
        <div className="flex gap-2">
          {usable.length > 0 ? (
            <Button type="button" disabled={pending || !provider} onClick={upload}>
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

            {usable.length === 0 ? (
              <p className="text-[var(--muted-fg)]">
                {state.connections.length === 0 ? "Личный диск не подключён. " : null}
                Подключите Google Диск или Яндекс Диск в{" "}
                <a href={profileHref} className="text-[var(--accent)] hover:underline">
                  Профиле
                </a>
                .
              </p>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 font-medium">Куда</legend>
                  {usable.map((c) => (
                    <label key={c.provider} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="drive-provider"
                        value={c.provider}
                        checked={provider === c.provider}
                        onChange={() => {
                          setProvider(c.provider);
                          setDone(null);
                          setError(null);
                        }}
                      />
                      <span>
                        Мой {cloudProviderLabels[c.provider]}
                        {c.accountEmail ? (
                          <span className="text-[var(--muted-fg)]"> · {c.accountEmail}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </fieldset>

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
                    : "Google Таблица — в папке «PELENA · <Проект>/Вызывные» на вашем диске."}{" "}
                  Повторная выгрузка заменяет тот же файл.
                </p>
                {provider === "YANDEX_DISK" ? (
                  <p className="rounded-lg border border-amber-500/30 bg-[var(--tone-warning-bg)] px-3 py-2 text-[var(--tone-warning-soft)]">
                    {YANDEX_PERSONAL_NOTE}
                  </p>
                ) : null}

                {existing && !done ? <ExistingExport view={existing} /> : null}
              </>
            )}

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
