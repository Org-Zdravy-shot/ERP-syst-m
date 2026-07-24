import { describe, expect, it } from "vitest";
import { assertOmegaCommitSafety } from "./safety";

const sha256 = "a".repeat(64);

describe("Omega commit safety", () => {
  it("accepts an explicitly confirmed, backed-up import", () => {
    expect(() =>
      assertOmegaCommitSafety({
        actualSha256: sha256,
        confirmedSha256: sha256,
        backupReference: "railway-backup-2026-07-24",
        actorId: "admin",
        markIssuedPaid: true,
        issuedPaidDateStrategy: "due-date",
      }),
    ).not.toThrow();
  });

  it("rejects commit without matching hash and backup", () => {
    expect(() =>
      assertOmegaCommitSafety({
        actualSha256: sha256,
        confirmedSha256: "b".repeat(64),
        actorId: "admin",
        markIssuedPaid: false,
      }),
    ).toThrow(/confirm-sha256/);
  });

  it("requires an explicit date strategy for historical paid invoices", () => {
    expect(() =>
      assertOmegaCommitSafety({
        actualSha256: sha256,
        confirmedSha256: sha256,
        backupReference: "railway-backup-2026-07-24",
        actorId: "admin",
        markIssuedPaid: true,
      }),
    ).toThrow(/issued-paid-date=due-date/);
  });
});
