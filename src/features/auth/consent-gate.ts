import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { needsPersonalDataConsent } from "@/features/auth/lib/personal-data-consent";
import { prisma } from "@/shared/db/prisma";

/** Вошедший пользователь без согласия на текущую редакцию политики идёт принимать её. */
export async function requirePersonalDataConsent(locale: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personalDataConsentVersion: true },
  });
  if (user && needsPersonalDataConsent(user.personalDataConsentVersion)) {
    redirect(`/${locale}/consent`);
  }
}
