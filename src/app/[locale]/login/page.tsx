import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/features/auth/components/login-form";
import { PrivacyPolicyFooter } from "@/features/auth/components/privacy-policy-footer";
import { AppBrand } from "@/shared/ui/app-brand";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; reset?: string }>;
};

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { callbackUrl, reset } = await searchParams;
  const t = await getTranslations("auth");
  const tApp = await getTranslations("app");

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-8 text-center">
        <Link href={`/${locale}`}>
          <AppBrand size="lg" />
        </Link>
        <p className="mt-2 text-sm text-[var(--muted-fg)]">{tApp("tagline")}</p>
      </div>
      <Card className="glass-strong">
        <h1 className="mb-6 font-display text-[27px] font-bold leading-tight">{t("loginTitle")}</h1>
        <LoginForm
          callbackUrl={callbackUrl}
          locale={locale}
          resetSuccess={reset === "1"}
        />
      </Card>
      <PrivacyPolicyFooter locale={locale} />
    </main>
  );
}
