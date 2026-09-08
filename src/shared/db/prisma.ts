import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isTransientDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Never retry interactive transaction failures — the tx is already dead.
    if (error.code === "P2028") return false;
    return ["P1001", "P1008", "P1017", "P2024"].includes(error.code);
  }
  if (error instanceof Error) {
    if (/Transaction not found|old closed transaction|Transaction API error/i.test(
      error.message,
    )) {
      return false;
    }
    return /closed the connection|connection terminated|ECONNRESET|ETIMEDOUT|Can't reach database/i.test(
      error.message,
    );
  }
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            if (attempt < maxAttempts - 1 && isTransientDbError(error)) {
              await sleep(400 * (attempt + 1));
              continue;
            }
            throw error;
          }
        }
        throw new Error("Database query failed after retries");
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

function getPrismaClient(): ExtendedPrismaClient {
  const cached = globalForPrisma.prisma as ExtendedPrismaClient | undefined;
  // After `prisma generate`, a long-lived global singleton can miss new models
  // (e.g. company) until the process restarts. Drop the stale instance in dev.
  if (
    cached &&
    process.env.NODE_ENV !== "production" &&
    (typeof (cached as { company?: unknown }).company === "undefined" ||
      typeof (cached as { projectFinanceVariable?: unknown })
        .projectFinanceVariable === "undefined" ||
      typeof (cached as { budgetTemplate?: unknown }).budgetTemplate ===
        "undefined" ||
      typeof (cached as { accrual?: unknown }).accrual === "undefined" ||
      typeof (cached as { cashPayment?: unknown }).cashPayment === "undefined")
  ) {
    void cached.$disconnect().catch(() => undefined);
    globalForPrisma.prisma = undefined;
  }

  const client =
    (globalForPrisma.prisma as ExtendedPrismaClient | undefined) ??
    createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client as unknown as PrismaClient;
  }

  return client;
}

export const prisma: ExtendedPrismaClient = getPrismaClient();
