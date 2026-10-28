import { Prisma } from "@prisma/client";

/** Удаление упёрлось в связанные записи (запрет в базе), например их добавили одновременно. */
export function isForeignKeyError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2014")
  );
}

export const LINKED_ERROR = "Есть связанные записи — удалить нельзя";
