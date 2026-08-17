import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCompositionForTests,
  getMailProvider,
  getWorkerStorage,
  mailSendingEnabled,
} from "./composition";

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCompositionForTests();
});

describe("produkčná kompozícia financií", () => {
  it("bez privátneho bucketu zlyhá namiesto zápisu na dočasný disk", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOCUMENT_BUCKET_NAME", "");
    vi.stubEnv("BUCKET", "");
    __resetCompositionForTests();

    expect(() => getWorkerStorage()).toThrow(/Produkčné úložisko/);
  });

  it("bez e-mailového providera zlyhá namiesto označenia LogMailProvider správy za odoslanú", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOCUMENT_BUCKET_NAME", "finance-private");
    vi.stubEnv("DOCUMENT_BUCKET_ENDPOINT", "https://bucket.invalid");
    vi.stubEnv("DOCUMENT_BUCKET_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("DOCUMENT_BUCKET_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("MAIL_PROVIDER", "SMTP");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("FINANCE_MAIL_DKIM_CONFIRMED", "true");
    __resetCompositionForTests();

    expect(mailSendingEnabled()).toBe(false);
    expect(() => getMailProvider()).toThrow(/e-mailového providera/);
  });

  it("v produkcii vyberie Resend HTTPS provider", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOCUMENT_BUCKET_NAME", "finance-private");
    vi.stubEnv("DOCUMENT_BUCKET_ENDPOINT", "https://bucket.invalid");
    vi.stubEnv("DOCUMENT_BUCKET_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("DOCUMENT_BUCKET_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("MAIL_PROVIDER", "RESEND");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "info@zdravyshot.sk");
    vi.stubEnv("FINANCE_MAIL_DKIM_CONFIRMED", "true");
    __resetCompositionForTests();

    expect(mailSendingEnabled()).toBe(true);
    expect(getMailProvider().providerName).toBe("RESEND");
  });
});
