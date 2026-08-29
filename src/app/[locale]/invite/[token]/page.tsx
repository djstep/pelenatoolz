import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { acceptInviteAction } from "@/features/projects/actions";
import { prisma } from "@/shared/db/prisma";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; token: string }>;
};

export default async function InvitePage({ params }: Props) {
  const { locale, token } = await params;
  const session = await auth();
  const t = await getTranslations("invite");
  const tNav = await getTranslations("nav");

  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: { project: true, role: true },
  });

  const invalid =
    !invite ||
    invite.revokedAt ||
    invite.acceptedAt ||
    invite.expiresAt < new Date();

  if (invalid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
        <Card className="w-full">
          <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-3 text-sm text-[var(--danger)]">
            Приглашение недействительно или срок его действия истёк.
          </p>
          <div className="mt-6">
            <Link href={`/${locale}/projects`}>
              <Button variant="secondary">К проектам</Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  const callbackUrl = `/${locale}/invite/${token}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full space-y-4">
        <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--muted-fg)]">{t("project")}</dt>
            <dd className="font-medium">{invite.project.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--muted-fg)]">{t("role")}</dt>
            <dd className="font-medium">{invite.role.name}</dd>
          </div>
        </dl>

        {session?.user ? (
          <form
            action={async () => {
              "use server";
              await acceptInviteAction(token);
            }}
          >
            <Button type="submit" className="w-full">
              {t("accept")}
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted-fg)]">{t("needAuth")}</p>
            <div className="flex gap-2">
              <Link
                href={`/${locale}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="flex-1"
              >
                <Button className="w-full" type="button">
                  {tNav("login")}
                </Button>
              </Link>
              <Link
                href={`/${locale}/register?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="flex-1"
              >
                <Button className="w-full" type="button" variant="secondary">
                  {tNav("register")}
                </Button>
              </Link>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
