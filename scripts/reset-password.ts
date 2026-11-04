/**
 * Сброс пароля владельцем, пока нет сброса по письму (волна 6б):
 *
 *   npm run user:reset-password -- <почта>                                  — база из .env
 *   npm run user:reset-password -- <почта> --prod                           — то же, если в .env прод
 *   npm run user:reset-password -- <почта> --env-file .env.prod --prod      — база из другого файла
 *
 * Новый пароль генерируется и один раз выводится в консоль, в базе только его хеш. В журнал идёт
 * запись без пароля. Человек выходит со всех устройств, блокировка входа снимается, ссылки сброса гаснут.
 * Строки подключения берутся только из этого файла: значения из окружения оболочки игнорируются.
 * `--prod` обязателен, если в файле прод, и запрещён, если не прод.
 * Файла нет: Node сам видит флаг --env-file и останавливается раньше скрипта с текстом «not found».
 */
import path from "node:path";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import {
  databaseHost,
  databaseProblem,
  generatePassword,
  parseResetPasswordArgs,
} from "../src/features/auth/lib/reset-password-cli";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const args = parseResetPasswordArgs(process.argv.slice(2));
  if ("error" in args) fail(args.error);

  const { parsed } = config({ path: path.resolve(args.envFile), override: true, quiet: true });
  const problem = databaseProblem([parsed?.DATABASE_URL, parsed?.DIRECT_URL], args.prod, args.envFile);
  if (problem) fail(problem);
  console.log(`База: ${databaseHost(parsed?.DATABASE_URL ?? "")}`);

  // Только здесь: клиент базы читает адрес при загрузке, а адрес уже проверен.
  const [{ prisma }, { auditMutation }, { AuditEntityType }, { loginLimitEmailPrefix }] = await Promise.all([
    import("../src/shared/db/prisma"),
    import("../src/shared/audit/with-audit"),
    import("../src/shared/audit/entity-types"),
    import("../src/features/auth/lib/login-limit"),
  ]);

  try {
    const user = await prisma.user.findUnique({ where: { email: args.email }, select: { id: true } });
    if (!user) fail("Пользователь с такой почтой не найден");

    const password = generatePassword(args.email);
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      await auditMutation(
        { user: { id: user.id } },
        async () => {
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, sessionVersion: { increment: 1 } },
          });
          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          await tx.rateLimitCounter.deleteMany({
            where: {
              OR: [
                { key: { startsWith: loginLimitEmailPrefix(args.email) } },
                { key: `password-change:${user.id}` },
              ],
            },
          });
        },
        null,
        {
          projectId: null,
          entityType: AuditEntityType.userPassword,
          entityId: user.id,
          action: "UPDATE",
          summary: "Пароль сброшен владельцем через скрипт",
          changes: { source: "owner-script" },
        },
        { db: tx },
      );
    });

    console.log(`Пароль для ${args.email} сброшен, вход со всех устройств отменён, блокировка снята.`);
    console.log(`Новый пароль (больше нигде не сохранён): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Не удалось сбросить пароль");
});
