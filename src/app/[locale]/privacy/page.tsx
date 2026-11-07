import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { policyParts, PRIVACY_POLICY_TEXT } from "@/features/auth/lib/privacy-policy-text";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { AppBrand } from "@/shared/ui/app-brand";
import { Card } from "@/shared/ui/card";

type Props = { params: Promise<{ locale: string }> };

/** Политика обработки персональных данных: открывается без входа. */
export default async function PrivacyPolicyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("auth");
  const parts = policyParts(PRIVACY_POLICY_TEXT);

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-8 text-center">
        <Link href={`/${locale}`}>
          <AppBrand size="lg" />
        </Link>
      </div>
      <Card className="glass-strong">
        <div className="space-y-3 text-sm leading-relaxed" data-testid="privacy-policy">
          {parts.map((part, index) =>
            part.kind === "title" ? (
              <h1 key={index} className="mb-4 font-display text-[27px] font-bold leading-tight">
                {part.text}
              </h1>
            ) : part.kind === "heading" ? (
              <h2 key={index} className="pt-4 text-base font-semibold">
                {part.text}
              </h2>
            ) : (
              <p key={index} className="break-words">
                {part.text}
              </p>
            ),
          )}
        </div>
        <p className="mt-6 text-center text-sm">
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
