import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isTransientDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1001", "P1008", "P1017", "P2024"].includes(error.code);
  }
  if (error instanceof Error) {
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

export const prisma: ExtendedPrismaClient =
  (globalForPrisma.prisma as ExtendedPrismaClient | undefined) ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma as unknown as PrismaClient;
}
