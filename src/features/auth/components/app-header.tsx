import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { logoutAction } from "@/features/auth/actions";
import { HeaderMenu } from "@/features/auth/components/header-menu";
import { prisma } from "@/shared/db/prisma";
import { AppBrand } from "@/shared/ui/app-brand";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { Button } from "@/shared/ui/button";

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
            <Link href={`/${locale}/profile`} role="menuitem" className="glass-dropdown-item truncate px-3 py-2">
              {profile?.name || session.user.name || session.user.email}
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
          <Link
            href={`/${locale}/profile`}
            title="Профиль"
            className="hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[var(--muted-fg)] transition hover:text-[var(--foreground)] sm:inline"
          >
            {profile?.name || session.user.name || session.user.email}
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost">
              {t("logout")}
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
