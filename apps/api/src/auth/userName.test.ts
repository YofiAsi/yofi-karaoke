import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { findUserByName, isUniqueViolation } from "./userName.js";

function readerReturning(rows: unknown[]) {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) };
}

function renderedSql(reader: ReturnType<typeof readerReturning>): string {
  const [parts] = reader.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return parts.join("$1");
}

describe("findUserByName()", () => {
  it("compares lower cased names with equality, never a LIKE pattern", async () => {
    const reader = readerReturning([]);
    await findUserByName(reader as never, "%");
    const sql = renderedSql(reader);
    expect(sql).toMatch(/lower\(name\) = lower\(\$1\)/);
    expect(sql).not.toMatch(/LIKE/i);
  });

  it("passes wildcard characters as a bound parameter, not as SQL", async () => {
    const reader = readerReturning([]);
    await findUserByName(reader as never, "  _a\\% ");
    const [parts, ...values] = reader.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toEqual(["_a\\%"]);
    expect(parts.join("")).not.toContain("_a");
  });

  it("returns the oldest match or null", async () => {
    const alice = { id: "u1", name: "Alice", isHost: false };
    expect(await findUserByName(readerReturning([alice]) as never, "alice")).toEqual(alice);
    expect(await findUserByName(readerReturning([]) as never, "nobody")).toBeNull();
    const reader = readerReturning([]);
    await findUserByName(reader as never, "x");
    expect(renderedSql(reader)).toMatch(/ORDER BY "createdAt" ASC\s+LIMIT 1/);
  });
});

describe("isUniqueViolation()", () => {
  it("recognises Prisma P2002 only", () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" });
    const p2025 = new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "t" });
    expect(isUniqueViolation(p2002)).toBe(true);
    expect(isUniqueViolation(p2025)).toBe(false);
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
  });
});
