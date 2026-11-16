import { describe, expect, it } from "vitest";
import { nameUrlFor, returnPathFromSearch, safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
  it("keeps same origin relative paths", () => {
    expect(safeReturnPath("/tv")).toBe("/tv");
    expect(safeReturnPath("/library?q=abc")).toBe("/library?q=abc");
  });

  it("rejects missing, absolute, protocol relative and backslash paths", () => {
    for (const raw of [null, undefined, "", "tv", "https://evil.example", "//evil.example", "/\\evil.example", "/\tx"]) {
      expect(safeReturnPath(raw)).toBe("/");
    }
  });

  it("does not loop back to the name page", () => {
    expect(safeReturnPath("/name")).toBe("/");
    expect(safeReturnPath("/name?next=/tv")).toBe("/");
  });
});

describe("returnPathFromSearch and nameUrlFor", () => {
  it("round trips a return path through the name page url", () => {
    expect(nameUrlFor("/tv")).toBe("/name?next=%2Ftv");
    expect(returnPathFromSearch("?next=%2Ftv")).toBe("/tv");
    expect(returnPathFromSearch("?next=%2F%2Fevil.example")).toBe("/");
    expect(nameUrlFor("/")).toBe("/name");
  });
});
