import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/features/auth/components/login-form";
import { AppBrand } from "@/shared/ui/app-brand";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { callbackUrl } = await searchParams;
  const t = await getTranslations("auth");
  const tApp = await getTranslations("app");

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[var(--accent)]/20 blur-[80px]"
      />
      <div className="mb-8 text-center">
        <Link href={`/${locale}`}>
          <AppBrand size="lg" />
        </Link>
        <p className="mt-2 text-sm text-[var(--muted-fg)]">{tApp("tagline")}</p>
      </div>
      <Card className="glass-strong">
        <h1 className="mb-6 font-display text-2xl font-semibold">{t("loginTitle")}</h1>
        <LoginForm callbackUrl={callbackUrl} locale={locale} />
      </Card>
    </main>
  );
}
