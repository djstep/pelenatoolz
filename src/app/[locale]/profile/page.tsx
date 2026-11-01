import { AppHeader } from "@/features/auth/components/app-header";
import { requireUser } from "@/features/auth/session";
import { CloudConnectionsPanel } from "@/features/cloud/components/cloud-file-picker";
import { CloudOAuthNoticeLine } from "@/features/cloud/components/cloud-oauth-notice";
import { listUserCloudConnections } from "@/features/cloud/lib/cloud-service";
import { cloudOAuthNotice } from "@/features/cloud/lib/oauth-notice";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProfilePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const notice = cloudOAuthNotice(await searchParams);
  const sessionUser = await requireUser();
  const [user, connections] = await Promise.all([
    prisma.user.findUnique({
      where: { id: sessionUser.id! },
      select: { email: true, name: true, phone: true, googleEmail: true },
    }),
    listUserCloudConnections(sessionUser.id!),
  ]);

  return (
    <>
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 font-display text-3xl font-semibold">Профиль</h1>
        <Card>
          {user ? (
            <ProfileForm
              email={user.email}
              profile={{
                name: user.name,
                phone: user.phone ?? "",
                googleEmail: user.googleEmail ?? "",
              }}
            />
          ) : (
            <p className="text-sm text-[var(--danger)]">Пользователь не найден</p>
          )}
        </Card>
        <section className="mt-6" id="cloud">
          <Card>
            <h2 className="mb-1 font-display text-xl font-semibold">Личные диски</h2>
            <p className="mb-4 text-sm text-[var(--muted-fg)]">
              Свой Google Диск или Яндекс Диск — для выгрузки документов себе. Система видит на диске
              только файлы и папки, которые создала сама.
            </p>
            {notice ? <CloudOAuthNoticeLine notice={notice} /> : null}
            <CloudConnectionsPanel connections={connections} returnTo={`/${locale}/profile`} />
          </Card>
        </section>
      </main>
    </>
  );
}
