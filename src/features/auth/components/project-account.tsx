import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { logoutAction } from "@/features/auth/actions";
import { currentDisplayName, initials } from "@/features/auth/components/app-header";
import { HeaderMenu } from "@/features/auth/components/header-menu";
import { ThemeToggle } from "@/shared/theme/theme-toggle";

/** Кнопка-значок на тёмном меню (тема, «гамбургер»). */
const SIDEBAR_ICON_BUTTON =
  "h-9 w-9 justify-center border-transparent bg-transparent px-0 text-[var(--sidebar-fg-2)] hover:border-transparent hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]";

/**
 * Низ бокового меню проекта (от `lg`): пользователь — «Меню пользователя» (→ «Профиль», «Выйти»)
 * и переключатель темы. Раньше это было в шапке; в проекте шапки больше нет.
 */
export async function SidebarAccount({ locale }: { locale: string }) {
  const displayName = await currentDisplayName(locale);
  const t = await getTranslations("nav");

  return (
    <div className="flex items-center gap-1">
      <HeaderMenu
        label="Меню пользователя"
        className="relative min-w-0 flex-1"
        placement="top"
        triggerClassName="flex w-full min-w-0 items-center gap-2.5 rounded-lg py-1.5 pl-1 pr-2 text-left text-sm text-[var(--sidebar-fg)] transition-colors hover:bg-[var(--sidebar-hover)]"
        trigger={
          <>
            <span
              aria-hidden
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-active-bg)] text-xs font-semibold text-[var(--sidebar-active-fg)]"
            >
              {initials(displayName)}
            </span>
            <span className="min-w-0 truncate">{displayName}</span>
          </>
        }
      >
        <Link href={`/${locale}/profile`} role="menuitem" className="glass-dropdown-item px-3 py-2">
          Профиль
        </Link>
        <form action={logoutAction}>
          <button type="submit" role="menuitem" className="glass-dropdown-item w-full px-3 py-2 text-left">
            {t("logout")}
          </button>
        </form>
      </HeaderMenu>
      <ThemeToggle iconOnly className={SIDEBAR_ICON_BUTTON} />
    </div>
  );
}

/** Телефон (до `lg`): тема и «Меню аккаунта» (проекты, профиль, выход) — как раньше в шапке. */
export async function MobileAccount({ locale }: { locale: string }) {
  const displayName = await currentDisplayName(locale);
  const t = await getTranslations("nav");

  return (
    <div className="flex shrink-0 items-center gap-1">
      <ThemeToggle iconOnly className={SIDEBAR_ICON_BUTTON} />
      <HeaderMenu
        className="relative"
        triggerClassName="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--sidebar-fg-2)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]"
      >
        <Link href={`/${locale}/projects`} role="menuitem" className="glass-dropdown-item px-3 py-2">
          {t("projects")}
        </Link>
        <Link href={`/${locale}/profile`} role="menuitem" className="glass-dropdown-item flex flex-col px-3 py-2">
          <span>Профиль</span>
          <span className="truncate text-xs text-[var(--muted-fg)]">{displayName}</span>
        </Link>
        <form action={logoutAction}>
          <button type="submit" role="menuitem" className="glass-dropdown-item w-full px-3 py-2 text-left">
            {t("logout")}
          </button>
        </form>
      </HeaderMenu>
    </div>
  );
}
