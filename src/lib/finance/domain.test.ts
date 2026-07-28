import { expect, test } from "vitest";
import {
  assertDocumentTransition,
  assertCreditWithinOriginal,
  calculateInvoice,
  calculatePaymentStatus,
  canTransitionDocument,
  FinanceDomainError,
  formatDocumentNumber,
  isDateWithinValidity,
} from "./domain";
import { hasFinancePermission } from "./permissions";
import { evaluateProductionIssuingInfrastructure } from "./invoice-service";

test("DPH sa zaokrúhľuje po jednotlivých položkách", () => {
  const result = calculateInvoice({
    currency: "EUR",
    lines: [
      { description: "A", quantity: 1, unit: "ks", unitPriceCents: 2, vatRate: 23 },
      { description: "B", quantity: 1, unit: "ks", unitPriceCents: 2, vatRate: 23 },
      { description: "C", quantity: 3, unit: "ks", unitPriceCents: 123, vatRate: 23 },
    ],
  });

  expect(result.lines.map((line) => line.totalVatCents)).toEqual([0, 0, 85]);
  expect(result.totalNetCents).toBe(373);
  expect(result.totalVatCents).toBe(85);
  expect(result.totalGrossCents).toBe(458);
});

test("oslobodená položka nemôže niesť nenulovú DPH", () => {
  expect(
    () =>
      calculateInvoice({
        currency: "EUR",
        lines: [
          {
            description: "Oslobodená služba",
            quantity: 1,
            unit: "ks",
            unitPriceCents: 100,
            vatRate: 23,
            taxCategory: "EXEMPT",
          },
        ],
      }),
  ).toThrowError(expect.objectContaining({ code: "INVALID_LINE" }));
});

test("stav úhrady sa počíta výhradne zo sumy aktívnych alokácií", () => {
  expect(calculatePaymentStatus(1_000, 0)).toBe("UNPAID");
  expect(calculatePaymentStatus(1_000, 400)).toBe("PARTIALLY_PAID");
  expect(calculatePaymentStatus(1_000, 1_000)).toBe("PAID");
  expect(calculatePaymentStatus(1_000, 1_001)).toBe("OVERPAID");
});

test("povolené prechody chránia nemennosť finalizovaného dokladu", () => {
  expect(canTransitionDocument("DRAFT", "ISSUED")).toBe(true);
  expect(canTransitionDocument("ISSUED", "DRAFT")).toBe(false);
  expect(canTransitionDocument("CANCELLED", "ISSUED")).toBe(false);
  expect(() => assertDocumentTransition("ISSUED", "DRAFT")).toThrow(FinanceDomainError);
});

test("časová platnosť je na oboch hraniciach inkluzívna", () => {
  const from = new Date("2026-07-01T00:00:00.000Z");
  const to = new Date("2026-07-31T23:59:59.999Z");
  expect(isDateWithinValidity(from, from, to)).toBe(true);
  expect(isDateWithinValidity(to, from, to)).toBe(true);
  expect(isDateWithinValidity(new Date("2026-08-01T00:00:00.000Z"), from, to)).toBe(false);
});

test("oficiálny rad vydaných faktúr pokračuje číslom 2026009", () => {
  expect(formatDocumentNumber("VYDANA", 2026, 9)).toBe("2026009");
  expect(formatDocumentNumber("PRIJATA", 2026, 9)).toBe("PF2026009");
});

test("finančný operátor nemôže finalizovať ani meniť daňové nastavenia", () => {
  expect(hasFinancePermission("FINANCE_OPERATOR", "VIEW")).toBe(true);
  expect(hasFinancePermission("FINANCE_OPERATOR", "CREATE_DRAFT")).toBe(true);
  expect(hasFinancePermission("FINANCE_OPERATOR", "SEND_DOCUMENT")).toBe(true);
  expect(hasFinancePermission("FINANCE_OPERATOR", "FINALIZE")).toBe(false);
  expect(hasFinancePermission("FINANCE_OPERATOR", "CONFIGURE")).toBe(false);
  expect(hasFinancePermission("admin", "FINALIZE")).toBe(true);
  expect(hasFinancePermission("user", "VIEW")).toBe(false);
});

test("produkčná infraštruktúra je fail-closed", () => {
  const blocked = evaluateProductionIssuingInfrastructure({ NODE_ENV: "production" });
  expect(blocked.ready).toBe(false);
  expect(blocked.blockers.length).toBeGreaterThanOrEqual(4);

  const ready = evaluateProductionIssuingInfrastructure({
    NODE_ENV: "production",
    FINANCE_PRODUCTION_ISSUING_ENABLED: "true",
    DOCUMENT_BUCKET_NAME: "finance-private",
    DOCUMENT_BUCKET_ENDPOINT: "https://bucket.example.test",
    DOCUMENT_BUCKET_ACCESS_KEY_ID: "bucket-access",
    DOCUMENT_BUCKET_SECRET_ACCESS_KEY: "bucket-secret",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-password",
    MAIL_FROM: "info@zdravyshot.sk",
    FINANCE_MAIL_DKIM_CONFIRMED: "true",
  });
  expect(ready).toEqual({ ready: true, blockers: [] });

  const incomplete = evaluateProductionIssuingInfrastructure({
    NODE_ENV: "production",
    FINANCE_PRODUCTION_ISSUING_ENABLED: "true",
    DOCUMENT_BUCKET_NAME: "finance-private",
    SMTP_HOST: "smtp.example.sk",
    MAIL_FROM: "info@zdravyshot.sk",
  });
  expect(incomplete.ready).toBe(false);
  expect(incomplete.blockers).toContain(
    "Nie je nastavený endpoint privátneho bucketu.",
  );
});

test("dobropisy nemôžu prekročiť sumu pôvodnej faktúry", () => {
  expect(() => assertCreditWithinOriginal(10_000, 4_000, 6_000)).not.toThrow();
  expect(
    () => assertCreditWithinOriginal(10_000, 4_000, 6_001),
  ).toThrowError(expect.objectContaining({ code: "INVALID_MONEY" }));
});
