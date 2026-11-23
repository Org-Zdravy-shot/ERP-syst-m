import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), permission: vi.fn(), lookup: vi.fn(),
  findMany: vi.fn(), query: vi.fn(), create: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/finance/permissions", () => ({ requireFinancePermission: mocks.permission }));
vi.mock("@/lib/company-lookup", () => ({ lookupCompanyRegistry: mocks.lookup }));
vi.mock("@/lib/tax-register/lookup", () => ({
  loadCustomerTaxRegister: async () => ({}),
  lookupCustomerTax: () => ({ dic: "", icDph: "", vatStatus: "UNKNOWN" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  client: { findMany: mocks.findMany },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({
    $queryRaw: mocks.query, client: { create: mocks.create }, auditLog: { create: mocks.audit },
  }),
} }));

import { saveInvoiceClient, searchCompanies } from "./company-actions";

const billing = { name: "Nová firma", ico: "00123456", dic: "", icDph: "", street: "Hlavná 1", city: "Bratislava", zip: "811 01", country: "SK" };
const local = { id: "existing", ...billing };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: "user" });
  mocks.permission.mockResolvedValue({ userId: "finance" });
  mocks.findMany.mockResolvedValue([]);
  mocks.lookup.mockResolvedValue([]);
  mocks.query.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "created", name: billing.name, type: "B2B" });
});

describe("company search", () => {
  it("authenticates before database and paid registry calls", async () => {
    mocks.requireUser.mockRejectedValue(new Error("unauthorized"));
    await expect(searchCompanies("Firma")).rejects.toThrow("unauthorized");
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("keeps existing ERP data and deduplicates external results by ICO", async () => {
    mocks.findMany.mockResolvedValue([{ ...local, ico: "00 123 456" }]);
    mocks.lookup.mockResolvedValue([{ ...billing, id: "autoform:1", name: "Iný názov v registri", source: "AUTOFORM" }]);
    const result = await searchCompanies("Dedup company");
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]).toMatchObject({ clientId: "existing", name: billing.name, source: "ERP" });
  });
  it("still returns saved clients when the online register is unavailable", async () => {
    mocks.findMany.mockResolvedValue([local]);
    mocks.lookup.mockRejectedValue(new Error("Online register nie je pripojený."));
    expect(await searchCompanies("Offline company")).toMatchObject({ companies: [{ clientId: "existing" }], notice: "Online register nie je pripojený." });
  });
  it("caches repeated registry queries but refreshes ERP contacts", async () => {
    await searchCompanies("Cache company");
    await searchCompanies("Cache company");
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.requireUser).toHaveBeenCalledTimes(2);
  });
  it("does not query for overly short input", async () => {
    expect(await searchCompanies("  a ")).toEqual({ companies: [] });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("saving a client while drafting an invoice", () => {
  it("requires invoice permission before any write", async () => {
    mocks.permission.mockRejectedValue(new Error("forbidden"));
    await expect(saveInvoiceClient(billing)).rejects.toThrow("forbidden");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("normalizes ICO, serializes creation and records an audit entry", async () => {
    expect(await saveInvoiceClient({ ...billing, ico: "00 123 456" })).toMatchObject({ client: { id: "created" } });
    expect(mocks.query.mock.calls[0][1]).toBe("invoice-client:00123456");
    expect(mocks.query.mock.calls[1][1]).toBe("00123456");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: { ...billing, type: "B2B", dic: null, icDph: null } }));
    expect(mocks.audit).toHaveBeenCalledWith({ data: { actorId: "finance", action: "CLIENT_CREATED_FROM_INVOICE", entityType: "Client", entityId: "created" } });
  });
  it("selects an existing client without creating or overwriting it", async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "existing", name: "Uložený názov", type: "B2B", isActive: true }]);
    expect(await saveInvoiceClient(billing)).toEqual({ client: { id: "existing", name: "Uložený názov", type: "B2B" } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("does not recreate an archived client", async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "archived", isActive: false }]);
    expect(await saveInvoiceClient(billing)).toMatchObject({ error: expect.stringContaining("archivovaná") });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires explicit selection when legacy data contains multiple matches", async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "one" }, { id: "two" }]);
    expect(await saveInvoiceClient(billing)).toMatchObject({ error: expect.stringContaining("viac klientov") });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    { ico: "123" }, { dic: "abc" }, { icDph: "SK123" }, { country: "CZ" }, { name: "" },
  ])("rejects invalid billing fields %j before writes", async (patch) => {
    expect(await saveInvoiceClient({ ...billing, ...patch })).toHaveProperty("error");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
