import { AppHeader } from "@/features/auth/components/app-header";
import { requireUser } from "@/features/auth/session";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  const sessionUser = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id! },
    select: { email: true, name: true, phone: true, googleEmail: true },
  });

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
      </main>
    </>
  );
}
