import { cn } from "@/shared/lib/cn";

/** Строка «диск подключён» / «не подключён: …» после возврата из окна согласия. */
export function CloudOAuthNoticeLine({
  notice,
}: {
  notice: { tone: "success" | "error"; text: string };
}) {
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      data-testid="cloud-oauth-notice"
      className={cn(
        "mb-4 rounded-xl border px-3 py-2 text-sm",
        notice.tone === "error"
          ? "border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.08)] text-[var(--danger)]"
          : "border-[var(--border)] text-[var(--foreground)]",
      )}
    >
      {notice.text}
    </p>
  );
}
