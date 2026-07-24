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

  it("bez SMTP zlyhá namiesto označenia LogMailProvider správy za odoslanú", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOCUMENT_BUCKET_NAME", "finance-private");
    vi.stubEnv("DOCUMENT_BUCKET_ENDPOINT", "https://bucket.invalid");
    vi.stubEnv("DOCUMENT_BUCKET_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("DOCUMENT_BUCKET_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PORT", "");
    __resetCompositionForTests();

    expect(mailSendingEnabled()).toBe(false);
    expect(() => getMailProvider()).toThrow(/SMTP provider/);
  });
});
