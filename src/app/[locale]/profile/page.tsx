import { AppHeader } from "@/features/auth/components/app-header";
import { requireUser } from "@/features/auth/session";
import { CloudConnectionsPanel } from "@/features/cloud/components/cloud-file-picker";
import { CloudOAuthNoticeLine } from "@/features/cloud/components/cloud-oauth-notice";
import { listUserCloudConnections } from "@/features/cloud/lib/cloud-service";
import { profileDriveEmailNotice } from "@/features/cloud/lib/drive-access-rules";
import { cloudOAuthNotice } from "@/features/cloud/lib/oauth-notice";
import { ChangePasswordForm } from "@/features/profile/components/change-password-form";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

// Vercel (Fluid compute, потолок 300 с): выгрузка на диск (до 50 с) и пересчёт доступов к папкам после ответа
// (`after()`, до 40 с) идут в одной функции — до 120 с. OAuth дисков — здесь же.
export const maxDuration = 120;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProfilePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const sessionUser = await requireUser();
  const [user, connections] = await Promise.all([
    prisma.user.findUnique({
      where: { id: sessionUser.id! },
      select: { email: true, name: true, phone: true, googleEmail: true },
    }),
    listUserCloudConnections(sessionUser.id!),
  ]);
  const notice = cloudOAuthNotice(query, connections);
  const passwordChanged =
    typeof query.passwordChanged === "string" ? query.passwordChanged : null;
  // Риск 4: на какую почту выдаются папки дисков проектов и не опечатка ли это.
  const driveEmail = user
    ? profileDriveEmailNotice({
        email: user.email,
        googleEmail: user.googleEmail,
        connectedGoogleEmail:
          connections.find((c) => c.provider === "GOOGLE_DRIVE")?.accountEmail ?? null,
      })
    : null;

  return (
    <>
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 font-display text-[27px] font-bold leading-tight">Профиль</h1>
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
          {driveEmail ? (
            <div className="mt-4 space-y-1 text-sm" data-testid="profile-drive-email">
              <p>
                Доступ к папкам проекта будет выдан на{" "}
                <span className="font-medium break-all">{driveEmail.grantEmail}</span>
                {user?.googleEmail ? null : " (почта входа — «Почта для Google» не указана)"}
              </p>
              {driveEmail.mismatch ? (
                <p className="text-[var(--danger)]" data-testid="profile-drive-email-mismatch">
                  Не совпадает с подключённым Google-аккаунтом ({driveEmail.mismatch}). Проверьте, нет ли
                  опечатки: в вызывных — телефоны людей, по ошибке они уйдут постороннему.
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
        {user ? (
          <section className="mt-6" id="password">
            <Card>
              <h2 className="mb-4 font-display text-[17px] font-bold">Пароль</h2>
              {passwordChanged ? (
                <p
                  className="mb-4 text-sm text-[var(--tone-success-strong)]"
                  role="status"
                  data-testid="password-changed"
                >
                  Пароль изменён. На других устройствах нужно войти заново.
                </p>
              ) : null}
              <ChangePasswordForm key={passwordChanged ?? "form"} email={user.email} />
            </Card>
          </section>
        ) : null}
        <section className="mt-6" id="cloud">
          <Card>
            <h2 className="mb-1 font-display text-[17px] font-bold">Личные диски</h2>
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
