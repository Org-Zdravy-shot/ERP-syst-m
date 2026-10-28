import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), attachment: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/finance/permissions", () => ({ requireFinancePermission: mocks.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { invoice: { findMany: mocks.findMany }, $transaction: mocks.transaction } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { recordHistoricalInvoice, verifyHistoricalInvoice } from "./_actions";

function bricolForm() {
  const data = new FormData();
  const values = {
    direction: "PRIJATA", legalEntity: "KURGI", historicalKind: "FINAL", partnerName: "BRICOL – M spol. s r.o.",
    externalNumber: "FV-11107/2026", issueDate: "2026-10-06", dueDate: "2026-10-20",
    taxCountry: "CZ", taxCurrency: "CZK", currency: "EUR", vatRate: "21", taxBase: "2 778,66", taxAmount: "583,62", taxTotal: "3 362,28", paymentGross: "137,46",
    variableSymbol: "421811107", paymentConfirmation: "SUPPLIER_CONFIRMED",
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ userId: "user-1", email: "admin@example.test" });
  mocks.findMany.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "invoice-bricol" });
  mocks.transaction.mockImplementation((fn) => fn({ invoice: { create: mocks.create, findUnique: mocks.findUnique, update: mocks.update }, documentAsset: { findFirst: mocks.attachment }, auditLog: { create: mocks.auditCreate } }));
});

test("BRICOL zachová CZK základ a daň oddelene od 137,46 EUR na úhradu", async () => {
  await recordHistoricalInvoice({}, bricolForm());
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    legalEntity: "KURGI", source: "HISTORICAL", externalNumber: "FV-11107/2026", invoiceNumber: null,
    taxCountry: "CZ", foreignVatRateBps: 2100, taxCurrency: "CZK", taxBaseMinor: 277866, taxAmountMinor: 58362, taxTotalMinor: 336228,
    currency: "EUR", totalGrossCents: 13746, totalNetCents: 0, totalVatCents: 0,
    paymentConfirmation: "SUPPLIER_CONFIRMED", verificationStatus: "UNVERIFIED",
    taxSnapshot: expect.objectContaining({ slovakInputVatClaimed: false, reviewRequired: true }),
  }), select: { id: true } });
  expect(mocks.redirect).toHaveBeenCalledWith("/financie/faktury/invoice-bricol");
  expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "HISTORICAL_INVOICE_RECORDED", entityId: "invoice-bricol" }) });
});

test("rovnaké externé číslo upozorní pred uložením a nespraví duplikát", async () => {
  mocks.findMany.mockResolvedValue([{ id: "older", totalGrossCents: 10000, issueDate: new Date("2026-10-06"), historicalKind: "PROFORMA" }]);
  const result = await recordHistoricalInvoice({}, bricolForm());
  expect(result.duplicateWarning).toMatch(/rovnakým externým číslom/);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("predfaktúra zostane neovereným konceptom bez nového čísla", async () => {
  const data = bricolForm(); data.set("historicalKind", "PROFORMA");
  await recordHistoricalInvoice({}, data);
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ documentStatus: "DRAFT", historicalKind: "PROFORMA", verificationStatus: "UNVERIFIED", invoiceNumber: null }), select: { id: true } });
});

test("historická vydaná faktúra zachová pôvodné číslo a domáce sumy bez vystavenia nového PDF", async () => {
  const data = bricolForm();
  data.set("direction", "VYDANA"); data.set("partnerName", "Historický odberateľ");
  data.set("taxCountry", "SK"); data.set("taxCurrency", "EUR");
  data.set("taxBase", "100,00"); data.set("taxAmount", "23,00"); data.set("taxTotal", "123,00"); data.set("paymentGross", "123,00");
  data.delete("paymentConfirmation");
  await recordHistoricalInvoice({}, data);
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    direction: "VYDANA", source: "HISTORICAL", invoiceNumber: null,
    totalNetCents: 10000, totalVatCents: 2300, totalGrossCents: 12300,
    counterpartySnapshot: { name: "Historický odberateľ", country: "SK" },
  }), select: { id: true } });
});

test("odmietne zamiešať CZK základ a EUR úhradu ako jednu sumu", async () => {
  const data = bricolForm(); data.set("taxTotal", "137,46");
  const result = await recordHistoricalInvoice({}, data);
  expect(result.error).toMatch(/Základ plus daň/);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("overenie historického dokladu vyžaduje priložený originál", async () => {
  mocks.findUnique.mockResolvedValue({ source: "HISTORICAL", verificationStatus: "UNVERIFIED" });
  mocks.attachment.mockResolvedValue(null);
  const missing = await verifyHistoricalInvoice("invoice-bricol", {}, new FormData());
  expect(missing.error).toMatch(/priložte originálny doklad/);
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.attachment.mockResolvedValue({ id: "attachment-1" });
  const verified = await verifyHistoricalInvoice("invoice-bricol", {}, new FormData());
  expect(verified.success).toMatch(/označený ako overený/);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "invoice-bricol" }, data: { verificationStatus: "VERIFIED" } });
});
