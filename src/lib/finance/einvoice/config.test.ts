import { describe, expect, it } from "vitest";
import { efakturaMissingConfig, readEFakturaConfig } from "./config";

describe("eFaktúra konfigurácia", () => {
  it("je predvolene fail-closed", () => {
    expect(() => readEFakturaConfig({})).toThrow(/vypnutá/);
    expect(efakturaMissingConfig({})).toEqual([
      "EINVOICE_ENABLED=1",
      "EFAKTURA_API_KEY",
      "EFAKTURA_ORGANIZATION_ID",
    ]);
  });

  it("povolí testovací kľúč bez produkčnej brány", () => {
    const config = readEFakturaConfig({
      EINVOICE_ENABLED: "1",
      EFAKTURA_API_KEY: "efk_pk_test_example",
      EFAKTURA_ORGANIZATION_ID: "org-1",
      EFAKTURA_API_BASE: "https://sandbox.example/v1/",
    });

    expect(config.mode).toBe("sandbox");
    expect(config.apiBase).toBe("https://sandbox.example/v1");
  });

  it("produkčný kľúč vyžaduje obe produkčné brány", () => {
    const env = {
      EINVOICE_ENABLED: "1",
      EFAKTURA_API_KEY: "efk_pk_live_example",
      EFAKTURA_ORGANIZATION_ID: "org-1",
    };
    expect(() => readEFakturaConfig(env)).toThrow(/Produkčná eFaktúra je zablokovaná/);
    expect(
      readEFakturaConfig({
        ...env,
        EINVOICE_LIVE_ENABLED: "1",
        FINANCE_PRODUCTION_ISSUING_ENABLED: "true",
      }).mode,
    ).toBe("production");
  });

  it("odmietne kľúč neznámeho typu", () => {
    expect(() =>
      readEFakturaConfig({
        EINVOICE_ENABLED: "1",
        EFAKTURA_API_KEY: "secret",
        EFAKTURA_ORGANIZATION_ID: "org-1",
      }),
    ).toThrow(/testovací alebo produkčný/);
  });
});
