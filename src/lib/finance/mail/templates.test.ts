import { describe, expect, it } from "vitest";
import { buildInvoiceEmail, buildReminderEmail, type InvoiceEmailData } from "./templates";

const base: InvoiceEmailData = {
  invoiceNumber: "2026009",
  documentType: "INVOICE",
  clientName: "Fitko Havran s.r.o.",
  totalGrossCents: 17820,
  variableSymbol: "2026009",
  iban: "SK9611000000002918599669",
  dueDate: new Date("2026-08-07T00:00:00Z"),
  issuerName: "Zdravý Shot, s. r. o.",
};

describe("buildInvoiceEmail", () => {
  it("obsahuje číslo, sumu, IBAN, VS a splatnosť", () => {
    const email = buildInvoiceEmail(base);
    expect(email.subject).toContain("Faktúra 2026009");
    expect(email.text).toContain("178,20 €");
    expect(email.text).toContain("SK9611000000002918599669");
    expect(email.text).toContain("2026009");
    expect(email.text).toContain("7. 8. 2026");
    expect(email.html).toContain("178,20 €");
  });

  it("dobropis nemá platobné údaje ani QR poznámku", () => {
    const email = buildInvoiceEmail({ ...base, documentType: "CREDIT_NOTE" });
    expect(email.subject).toContain("Dobropis");
    expect(email.text).not.toContain("Splatnosť");
    expect(email.text).not.toContain("PAY by square");
  });

  it("escapuje HTML v mene vystaviteľa", () => {
    const email = buildInvoiceEmail({ ...base, issuerName: "A&B <script>" });
    expect(email.html).toContain("A&amp;B &lt;script&gt;");
    expect(email.html).not.toContain("<script>");
  });
});

describe("buildReminderEmail", () => {
  it("je upomienka s počtom dní po splatnosti a sumou", () => {
    const email = buildReminderEmail({ ...base, daysOverdue: 12 });
    expect(email.subject).toContain("Upomienka");
    expect(email.text).toContain("12 dní");
    expect(email.text).toContain("178,20 €");
  });
});
