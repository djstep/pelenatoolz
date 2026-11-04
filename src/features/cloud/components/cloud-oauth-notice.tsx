"use client";

import { useEffect } from "react";
import { CLOUD_NOTICE_PARAMS } from "@/features/cloud/lib/oauth-notice";
import { cn } from "@/shared/lib/cn";

/**
 * Строка «диск подключён» / «не подключён: …» после возврата из окна согласия.
 * Показав её, убирает `?cloud_connected` / `?cloud_error` из адреса: иначе после «Отключить»
 * или F5 старое «подключён» висело бы рядом с карточкой «Не подключён».
 */
export function CloudOAuthNoticeLine({
  notice,
}: {
  notice: { tone: "success" | "error"; text: string };
}) {
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of CLOUD_NOTICE_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    // history.replaceState Next.js учитывает в роутере: следующий refresh — уже без параметра.
    if (changed) window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      data-testid="cloud-oauth-notice"
      className={cn(
        "mb-4 rounded-xl border px-3 py-2 text-sm",
        notice.tone === "error"
          ? "border-[var(--tone-danger-line)] bg-[var(--tone-danger-bg)] text-[var(--danger)]"
          : "border-[var(--border)] text-[var(--foreground)]",
      )}
    >
      {notice.text}
    </p>
  );
}
