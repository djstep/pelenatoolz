import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import {
  clientIp,
  LOGIN_RATE_LIMIT,
  loginLimitKey,
} from "@/features/auth/lib/login-limit";
import { loginSchema } from "@/features/auth/schemas";
import { prisma } from "@/shared/db/prisma";
import { checkRateLimit, resetRateLimit } from "@/shared/lib/rate-limit";

/** Попытки входа исчерпаны. Без подробностей: что именно заблокировано, посетитель не узнаёт. */
export class LoginBlockedError extends CredentialsSignin {
  code = "blocked";
}

/**
 * Хеш случайного пароля той же стоимости, что у настоящих: для несуществующей почты сверка занимает
 * столько же времени, и по задержке ответа нельзя узнать, есть ли такой пользователь.
 */
const NO_USER_PASSWORD_HASH = "$2b$12$N8wDbPCI/2DxKbBsP9oghORMEkCxNxqKcnAYWTiF9zNr7OI3koRtO";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.toLowerCase();

        // Здесь, а не в форме: сюда приходят и форма, и прямой запрос к /api/auth.
        // Попытка занимается до проверки пароля, одинаково для существующей и чужой почты.
        const limitKey = loginLimitKey(email, clientIp(request.headers));
        const { allowed } = await checkRateLimit(limitKey, LOGIN_RATE_LIMIT);
        if (!allowed) {
          throw new LoginBlockedError();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(
          parsed.data.password,
          user?.passwordHash ?? NO_USER_PASSWORD_HASH,
        );
        if (!user || !valid) {
          return null;
        }

        await resetRateLimit(limitKey);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 14,
  },
  pages: {
    signIn: "/ru/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  trustHost: true,
});
