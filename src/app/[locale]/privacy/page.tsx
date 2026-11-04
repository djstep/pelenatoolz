import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppBrand } from "@/shared/ui/app-brand";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
};

/** Политика обработки персональных данных: открывается без входа. Сейчас заглушка без текста. */
export default async function PrivacyPolicyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("auth");

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-8 text-center">
        <Link href={`/${locale}`}>
          <AppBrand size="lg" />
        </Link>
      </div>
      <Card className="glass-strong">
        <h1 className="mb-6 font-display text-[27px] font-bold leading-tight">
          {t("privacyPolicyTitle")}
        </h1>
        <p
          className="rounded-lg border border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-soft)]"
          data-testid="privacy-stub"
        >
          {t("privacyPolicyStub")}
        </p>
        <p className="mt-4 text-center text-sm">
          <Link
            href={`/${locale}/login`}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {t("backToLogin")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
