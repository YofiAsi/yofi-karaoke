import { describe, expect, it } from "vitest";
import { shironetQuery, shironetSearchUrl } from "./shironet";

describe("shironetQuery", () => {
  it("keeps the Hebrew words and drops brackets, separators and Latin text", () => {
    expect(shironetQuery("איתי לוי - שתשרף האהבה (קליפ רשמי) Itay Levi")).toBe("איתי לוי שתשרף האהבה");
    expect(shironetQuery("ארתור- שיר פתיחה")).toBe("ארתור שיר פתיחה");
  });

  it("keeps numbers and quotes inside words, and ignores text after a pipe", () => {
    expect(shironetQuery("עומר אדם - בן 32 | Omer Adam")).toBe("עומר אדם בן 32");
    expect(shironetQuery('להקת צה"ל - שיר')).toBe('להקת צה"ל שיר');
  });
});

describe("shironetSearchUrl", () => {
  it("builds an encoded search link for Hebrew titles", () => {
    expect(shironetSearchUrl("נופיה - פרח")).toBe(
      `https://shironet.mako.co.il/search?q=${encodeURIComponent("נופיה פרח")}`,
    );
  });

  it("gives no link for titles without Hebrew letters", () => {
    expect(shironetSearchUrl("Adele - Hello (Official Music Video)")).toBeNull();
    expect(shironetSearchUrl("Song 2")).toBeNull();
  });
});
