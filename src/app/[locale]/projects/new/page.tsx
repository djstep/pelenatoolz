import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppHeader } from "@/features/auth/components/app-header";
import { CreateProjectForm } from "@/features/projects/components/create-project-form";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function NewProjectPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("projects");
  const tCommon = await getTranslations("common");

  return (
    <>
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href={`/${locale}/projects`}
          className="text-sm text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← {tCommon("back")}
        </Link>
        <h1 className="mt-4 mb-6 font-display text-3xl font-semibold">
          {t("create")}
        </h1>
        <Card>
          <CreateProjectForm />
        </Card>
      </main>
    </>
  );
}
