import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PrivacyPolicyFooter } from "@/features/auth/components/privacy-policy-footer";
import { RegisterForm } from "@/features/auth/components/register-form";
import { AppBrand } from "@/shared/ui/app-brand";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { callbackUrl } = await searchParams;
  const t = await getTranslations("auth");
  const tApp = await getTranslations("app");

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <Link href={`/${locale}`} className="inline-flex justify-center">
          <AppBrand size="lg" />
        </Link>
        <p className="mt-2 text-sm text-[var(--muted-fg)]">{tApp("tagline")}</p>
      </div>
      <Card className="glass-strong">
        <h1 className="mb-6 font-display text-[27px] font-bold leading-tight">
          {t("registerTitle")}
        </h1>
        <RegisterForm callbackUrl={callbackUrl} locale={locale} />
      </Card>
      <PrivacyPolicyFooter locale={locale} />
    </main>
  );
}
