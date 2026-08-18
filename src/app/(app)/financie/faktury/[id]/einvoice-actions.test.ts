import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  invoiceFindUnique: vi.fn(),
  prepareAndValidate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/finance/permissions", () => ({
  requireFinancePermission: mocks.requirePermission,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findUnique: mocks.invoiceFindUnique } },
}));
vi.mock("@/lib/finance/einvoice/composition", () => ({
  getOutgoingEInvoiceValidationService: () => ({
    prepareAndValidate: mocks.prepareAndValidate,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { validateEInvoiceNow } from "./einvoice-actions";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requirePermission.mockResolvedValue({
    userId: "admin-1",
    email: "admin@example.test",
  });
});

test("validáciu spustí až po serverovej kontrole oprávnenia a dokladu", async () => {
  mocks.invoiceFindUnique.mockResolvedValue({
    direction: "VYDANA",
    documentStatus: "ISSUED",
  });
  mocks.prepareAndValidate.mockResolvedValue({
    status: "VALIDATED",
    reused: false,
    recipientFound: true,
    lookupUnavailable: false,
  });

  const result = await validateEInvoiceNow(
    "invoice-1",
    {},
    new FormData(),
  );

  expect(mocks.requirePermission).toHaveBeenCalledWith("SEND_DOCUMENT");
  expect(mocks.prepareAndValidate).toHaveBeenCalledWith(
    "invoice-1",
    "admin-1",
  );
  expect(mocks.revalidatePath).toHaveBeenCalledWith(
    "/financie/faktury/invoice-1",
  );
  expect(result.success).toMatch(/prešlo sandbox validáciou/);
});

test("prijatý doklad odmietne ešte pred volaním providera", async () => {
  mocks.invoiceFindUnique.mockResolvedValue({
    direction: "PRIJATA",
    documentStatus: "ISSUED",
  });

  const result = await validateEInvoiceNow(
    "invoice-1",
    {},
    new FormData(),
  );

  expect(result.error).toMatch(/iba z vydaného/);
  expect(mocks.prepareAndValidate).not.toHaveBeenCalled();
});
