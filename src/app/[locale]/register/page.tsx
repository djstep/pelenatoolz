import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/features/auth/components/register-form";
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
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[var(--accent-2)]/25 blur-[80px]"
      />
      <div className="mb-8 text-center">
        <Link
          href={`/${locale}`}
          className="font-display text-3xl font-semibold tracking-tight bg-gradient-to-br from-white via-[var(--foreground)] to-[var(--accent)] bg-clip-text text-transparent"
        >
          {tApp("name")}
        </Link>
        <p className="mt-2 text-sm text-[var(--muted-fg)]">{tApp("tagline")}</p>
      </div>
      <Card className="glass-strong">
        <h1 className="mb-6 font-display text-2xl font-semibold">
          {t("registerTitle")}
        </h1>
        <RegisterForm callbackUrl={callbackUrl} locale={locale} />
      </Card>
    </main>
  );
}
