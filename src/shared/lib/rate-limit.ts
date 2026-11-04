import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

export type RateLimitRule = {
  /** Сколько попыток разрешено в окне. Попытка с этим номером ещё проходит, следующая уже нет. */
  limit: number;
  windowMs: number;
  /** Сколько длится блок после исчерпания попыток. */
  blockMs: number;
};

/** Счётчики старше суток точно неактуальны: и окно, и блок намного короче. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Занимает одну попытку и говорит, можно ли её выполнять. Вызывать ДО проверки пароля:
 * одновременные запросы не проскочат мимо лимита, потому что счёт идёт одним запросом к базе.
 * Успешное действие снимает счётчик через `resetRateLimit`. Время берётся из базы.
 */
export async function checkRateLimit(key: string, rule: RateLimitRule): Promise<{ allowed: boolean }> {
  await prisma.rateLimitCounter.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
  });

  const clock = Prisma.sql`timezone('UTC', now())`;
  const blockEnd = Prisma.sql`${clock} + make_interval(secs => ${rule.blockMs / 1000}::double precision)`;
  const windowOpenedBefore = Prisma.sql`${clock} - make_interval(secs => ${rule.windowMs / 1000}::double precision)`;
  const limit = Prisma.sql`${rule.limit}::int`;
  // Счётчик устарел: блок закончился либо окно прошло без блока.
  const stale = Prisma.sql`(
    (c."blockedUntil" IS NOT NULL AND c."blockedUntil" <= ${clock})
    OR (c."blockedUntil" IS NULL AND c."windowStart" <= ${windowOpenedBefore})
  )`;

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitCounter" AS c ("key", "count", "windowStart", "blockedUntil")
    VALUES (
      ${key}, 1, ${clock},
      CASE WHEN 1 >= ${limit} THEN ${blockEnd} ELSE NULL END
    )
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN ${stale} THEN 1 ELSE c."count" + 1 END,
      "windowStart" = CASE WHEN ${stale} THEN ${clock} ELSE c."windowStart" END,
      "blockedUntil" = CASE
        WHEN ${stale} THEN CASE WHEN 1 >= ${limit} THEN ${blockEnd} ELSE NULL END
        WHEN c."blockedUntil" IS NOT NULL THEN c."blockedUntil"
        WHEN c."count" + 1 >= ${limit} THEN ${blockEnd}
        ELSE NULL
      END
    RETURNING c."count"
  `;
  return { allowed: rows[0].count <= rule.limit };
}

/** Снимает счётчик: действие удалось, копить неудачи дальше незачем. */
export async function resetRateLimit(key: string): Promise<void> {
  await prisma.rateLimitCounter.deleteMany({ where: { key } });
}
