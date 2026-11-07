import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptPersonalDataPolicyAction, logoutAction } from "@/features/auth/actions";
import { needsPersonalDataConsent } from "@/features/auth/lib/personal-data-consent";
import { requireUser } from "@/features/auth/session";
import { prisma } from "@/shared/db/prisma";
import { AppBrand } from "@/shared/ui/app-brand";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";

type Props = { params: Promise<{ locale: string }> };

/** Принятие новой редакции политики. Показывается один раз на редакцию. */
export default async function ConsentPage({ params }: Props) {
  const { locale } = await params;
  const sessionUser = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id! },
    select: { personalDataConsentVersion: true },
  });
  if (!needsPersonalDataConsent(user?.personalDataConsentVersion)) {
    redirect(`/${locale}/projects`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <AppBrand size="lg" />
      </div>
      <Card className="glass-strong space-y-4">
        <h1 className="font-display text-[22px] font-bold leading-tight">
          Политика обработки персональных данных
        </h1>
        <p className="text-sm">
          Опубликована новая редакция политики. Чтобы продолжить работу, ознакомьтесь с ней и примите её условия.
        </p>
        <form action={acceptPersonalDataPolicyAction} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <Checkbox name="personalDataConsent" required className="items-start">
            <span>
              Я принимаю условия{" "}
              <Link
                href={`/${locale}/privacy`}
                target="_blank"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Политики конфиденциальности и обработки персональных данных
              </Link>
            </span>
          </Checkbox>
          <Button type="submit" className="w-full">
            Принять
          </Button>
        </form>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" className="w-full">
            Выйти
          </Button>
        </form>
      </Card>
    </main>
  );
}
