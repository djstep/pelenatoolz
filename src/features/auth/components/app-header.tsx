import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { logoutAction } from "@/features/auth/actions";
import { HeaderMenu } from "@/features/auth/components/header-menu";
import { prisma } from "@/shared/db/prisma";
import { AppBrand } from "@/shared/ui/app-brand";
import { ThemeToggle } from "@/shared/theme/theme-toggle";

/** Инициалы для кружка в меню пользователя: «Анна Петрова» → «АП», почта → первая буква. */
function initials(name: string) {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  const letters = (words.length > 1 && !name.includes("@") ? words.slice(0, 2) : words.slice(0, 1))
    .map((w) => w[0]);
  return letters.join("").toLocaleUpperCase("ru") || "?";
}

export async function AppHeader({ locale }: { locale: string }) {
  const session = await auth();
  const t = await getTranslations("nav");

  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  // Имя — из базы: в сессии оно остаётся прежним до нового входа, а профиль его меняет.
  const profile = session.user.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } })
    : null;
  const displayName = profile?.name || session.user.name || session.user.email || "Профиль";

  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-5 lg:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link href={`/${locale}/projects`} className="shrink-0">
            <AppBrand size="header" />
          </Link>
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            <Link
              href={`/${locale}/projects`}
              className="rounded-lg px-3 py-1.5 text-[var(--muted-fg)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              {t("projects")}
            </Link>
          </nav>
        </div>
        {/* Телефон: тема и меню аккаунта (проекты, профиль, выход). */}
        <div className="flex shrink-0 items-center gap-2 sm:hidden">
          <ThemeToggle />
          <HeaderMenu>
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
        <div className="hidden items-center gap-3 text-sm sm:flex">
          <ThemeToggle />
          <HeaderMenu
            label="Меню пользователя"
            className="relative"
            trigger={
              <>
                <span
                  aria-hidden
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold"
                >
                  {initials(displayName)}
                </span>
                <span className="truncate text-[var(--muted-fg)]">{displayName}</span>
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
        </div>
      </div>
    </header>
  );
}
