import { Prisma, type PrismaClient } from "@prisma/client";

export interface NamedUser {
  id: string;
  name: string;
  isHost: boolean;
}

type UserReader = Pick<PrismaClient, "$queryRaw"> | Pick<Prisma.TransactionClient, "$queryRaw">;

export async function findUserByName(db: UserReader, name: string): Promise<NamedUser | null> {
  const rows = await db.$queryRaw<NamedUser[]>`
    SELECT id, name, "isHost" FROM "User"
    WHERE lower(name) = lower(${name.trim()})
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  return rows[0] ?? null;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
