"use client";

import { useRouter } from "next/navigation";
import type { CloudProvider } from "@prisma/client";
import { disconnectCloudAction } from "@/features/cloud/actions";
import {
  reconnectReasonText,
  type ReconnectReason,
} from "@/features/cloud/lib/scopes";
import { cloudProviderLabels } from "@/features/cloud/lib/types";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useToast } from "@/shared/ui/toast";

export type CloudConnectionView = {
  id: string;
  provider: CloudProvider;
  accountEmail: string | null;
  accountLabel: string | null;
  reconnectReason: ReconnectReason | null;
};

const AUTHORIZE_PATH: Record<CloudProvider, string> = {
  GOOGLE_DRIVE: "/api/cloud/google/authorize",
  YANDEX_DISK: "/api/cloud/yandex/authorize",
};

const PROVIDERS: CloudProvider[] = ["GOOGLE_DRIVE", "YANDEX_DISK"];

/**
 * Кнопка «Подключить» / «Переподключить» личный диск. POST-форма, а не ссылка:
 * переподключение отзывает старый токен, по чужой ссылке этого случиться не должно.
 */
export function CloudConnectButton({
  provider,
  returnTo,
  label,
  variant = "secondary",
}: {
  provider: CloudProvider;
  returnTo: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <form method="post" action={AUTHORIZE_PATH[provider]}>
      <input type="hidden" name="purpose" value="personal" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

/** Личные диски в «Профиле»: подключить, переподключить, отключить. */
export function CloudConnectionsPanel({
  connections,
  returnTo,
}: {
  connections: CloudConnectionView[];
  returnTo: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  return (
    <ul className="space-y-2 text-sm">
      {PROVIDERS.map((provider) => {
        const conn = connections.find((c) => c.provider === provider);
        const label = cloudProviderLabels[provider];
        return (
          <li
            key={provider}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
            data-testid={`cloud-connection-${provider}`}
          >
            <div className="min-w-0">
              <p className="font-medium">{label}</p>
              {conn ? (
                <p className="break-all text-[var(--muted-fg)]">
                  {conn.accountEmail ?? conn.accountLabel ?? "Подключено"}
                </p>
              ) : (
                <p className="text-[var(--muted-fg)]">Не подключён</p>
              )}
              {conn?.reconnectReason ? (
                <p className="text-[var(--danger)]">
                  {reconnectReasonText(provider, conn.reconnectReason)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <CloudConnectButton
                provider={provider}
                returnTo={returnTo}
                label={conn ? "Переподключить" : "Подключить"}
                variant={conn?.reconnectReason ? "primary" : "secondary"}
              />
              {conn ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void confirm({
                      title: `Отключить ${label}?`,
                      details: [
                        "Доступ приложения к диску будет отозван.",
                        "Файлы на диске останутся, ссылки в проектах — тоже.",
                      ],
                      confirmLabel: "Отключить",
                      action: async () => {
                        const result = await disconnectCloudAction(conn.id);
                        if (result.error) return result.error;
                        toast.success(result.success ?? "Диск отключён");
                        router.refresh();
                      },
                    })
                  }
                >
                  Отключить
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Плашка «переподключите» там, где диск нужен (страница «Файлы», позже — меню выгрузки). */
export function CloudReconnectNotice({
  connections,
  returnTo,
}: {
  connections: CloudConnectionView[];
  returnTo: string;
}) {
  const stale = connections.filter((c) => c.reconnectReason);
  if (stale.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="cloud-reconnect-notice">
      {stale.map((c) => (
        <div
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.08)] px-3 py-2 text-sm"
        >
          <span>{reconnectReasonText(c.provider, c.reconnectReason!)}</span>
          <CloudConnectButton
            provider={c.provider}
            returnTo={returnTo}
            label="Переподключить"
            variant="primary"
          />
        </div>
      ))}
    </div>
  );
}
