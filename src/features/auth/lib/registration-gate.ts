import { prisma } from "@/shared/db/prisma";
import {
  inviteAllowsRegistration,
  inviteTokenFromCallback,
  isAllowlisted,
  isInviteActive,
} from "@/features/auth/lib/registration-access";

async function findInvite(callbackUrl: unknown) {
  const token = inviteTokenFromCallback(callbackUrl);
  if (!token) return null;
  return prisma.projectInvite.findUnique({
    where: { token },
    select: { email: true, expiresAt: true, acceptedAt: true, revokedAt: true },
  });
}

/** Можно ли зарегистрировать эту почту: она в списке или человек пришёл по действующему приглашению. */
export async function canRegister(email: string, callbackUrl: unknown): Promise<boolean> {
  if (isAllowlisted(email)) return true;
  return inviteAllowsRegistration(await findInvite(callbackUrl), email);
}

/** Страница регистрации открыта по действующему приглашению. */
export async function hasActiveInvite(callbackUrl: unknown): Promise<boolean> {
  return isInviteActive(await findInvite(callbackUrl));
}

/** Почта берётся из базы, а не из сессии: в токене входа она может устареть. */
export async function canCreateProjects(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return isAllowlisted(user?.email);
}
