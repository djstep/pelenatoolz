import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { logoutAction } from "@/features/auth/actions";
import { AppBrand } from "@/shared/ui/app-brand";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { Button } from "@/shared/ui/button";

export async function AppHeader({ locale }: { locale: string }) {
  const session = await auth();
  const t = await getTranslations("nav");

  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-5 lg:px-6">
        <div className="flex items-center gap-6">
          <Link href={`/${locale}/projects`}>
            <AppBrand />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href={`/${locale}/projects`}
              className="rounded-lg px-3 py-1.5 text-[var(--muted-fg)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              {t("projects")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <ThemeToggle />
          <span className="hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[var(--muted-fg)] sm:inline">
            {session.user.name ?? session.user.email}
          </span>
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
