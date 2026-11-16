// Error carrying an HTTP status, rendered by the Fastify error handler as { error: code }.
import { Prisma } from "@prisma/client";

export type HttpError = Error & { statusCode: number };

export function httpError(statusCode: number, code: string): HttpError {
  return Object.assign(new Error(code), { statusCode });
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function asAlreadyQueued<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, "already_queued");
    throw err;
  }
}
