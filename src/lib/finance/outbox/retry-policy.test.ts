import { describe, expect, it } from "vitest";
import { decideRetry } from "./retry-policy";
import { mailBackoffMs } from "@/lib/finance/mail/config";

describe("decideRetry", () => {
  it("opakuje pokým nedosiahne maxAttempts, potom trvalo zlyhá", () => {
    const max = 5;
    expect(decideRetry(0, max).action).toBe("retry"); // 1. pokus zlyhal → 2.
    expect(decideRetry(1, max).action).toBe("retry");
    expect(decideRetry(2, max).action).toBe("retry");
    expect(decideRetry(3, max).action).toBe("retry"); // → 4. pokus
    expect(decideRetry(4, max).action).toBe("fail"); // 5. pokus by bol posledný
  });

  it("nextAttempts sa inkrementuje", () => {
    expect(decideRetry(0).nextAttempts).toBe(1);
    expect(decideRetry(3).nextAttempts).toBe(4);
  });

  it("delayMs pri retry rastie (exponenciálny backoff) a je kladné", () => {
    const d0 = decideRetry(0, 5).delayMs;
    const d1 = decideRetry(1, 5).delayMs;
    const d2 = decideRetry(2, 5).delayMs;
    expect(d0).toBeGreaterThan(0);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it("delayMs pri fail je 0", () => {
    expect(decideRetry(4, 5).delayMs).toBe(0);
  });
});

describe("mailBackoffMs", () => {
  it("je monotónne neklesajúce a zastropené", () => {
    const values = [0, 1, 2, 3, 4, 5, 10].map(mailBackoffMs);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    // strop 4 h
    expect(mailBackoffMs(99)).toBe(240 * 60 * 1000);
  });
});
