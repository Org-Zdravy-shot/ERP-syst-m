import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  transaction: vi.fn(),
  supplierCreate: vi.fn(),
  supplierFindUnique: vi.fn(),
  tagCreateMany: vi.fn(),
  auditCreate: vi.fn(),
  contactUpdateMany: vi.fn(),
  contactCreate: vi.fn(),
  bankUpdateMany: vi.fn(),
  bankCreate: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    supplier: { findUnique: mocks.supplierFindUnique },
  },
}));

import {
  createSupplier,
  createSupplierBankAccount,
  createSupplierContact,
} from "./_actions";

function supplierForm() {
  const form = new FormData();
  form.set("kind", "COMPANY");
  form.set("name", "  Medárstvo Orava  ");
  form.set("email", "med@example.sk");
  form.set("paymentTermsDays", "30");
  form.set("source", "REFERRAL");
  form.set("tags", " Med, obaly, med ");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    userId: "admin-1",
    email: "admin@zdravyshot.sk",
    role: "admin",
  });
  mocks.supplierCreate.mockResolvedValue({
    id: "supplier-1",
    name: "Medárstvo Orava",
    kind: "COMPANY",
    source: "REFERRAL",
  });
  mocks.tagCreateMany.mockResolvedValue({ count: 2 });
  mocks.auditCreate.mockResolvedValue({});
  mocks.contactUpdateMany.mockResolvedValue({ count: 0 });
  mocks.contactCreate.mockResolvedValue({
    id: "contact-1",
    name: "Ján Včelár",
    role: "Majiteľ",
    isPrimary: true,
  });
  mocks.bankUpdateMany.mockResolvedValue({ count: 0 });
  mocks.bankCreate.mockResolvedValue({
    id: "bank-1",
    iban: "SK3112000000198742637541",
    isPrimary: true,
  });
  mocks.supplierFindUnique.mockResolvedValue({ id: "supplier-1" });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      supplier: { create: mocks.supplierCreate },
      supplierTag: { createMany: mocks.tagCreateMany },
      supplierContact: {
        updateMany: mocks.contactUpdateMany,
        create: mocks.contactCreate,
      },
      supplierBankAccount: {
        updateMany: mocks.bankUpdateMany,
        create: mocks.bankCreate,
      },
      auditLog: { create: mocks.auditCreate },
    }),
  );
  mocks.redirect.mockImplementation(() => {
    throw new Error("redirect");
  });
});

test("vytvorenie dodávateľa normalizuje štítky a audituje zmenu", async () => {
  await expect(createSupplier({}, supplierForm())).rejects.toThrow("redirect");

  expect(mocks.supplierCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      name: "Medárstvo Orava",
      email: "med@example.sk",
      paymentTermsDays: 30,
    }),
  });
  expect(mocks.tagCreateMany).toHaveBeenCalledWith({
    data: [
      { supplierId: "supplier-1", name: "med" },
      { supplierId: "supplier-1", name: "obaly" },
    ],
  });
  expect(mocks.auditCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ action: "SUPPLIER_CREATED", entityId: "supplier-1" }),
  });
  expect(mocks.redirect).toHaveBeenCalledWith("/dodavatelia/supplier-1");
});

test("neplatný profil sa odmietne pred zápisom", async () => {
  const form = supplierForm();
  form.set("email", "zly-email");

  await expect(createSupplier({}, form)).resolves.toMatchObject({ error: "Neplatný e-mail" });
  expect(mocks.requireUser).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("hlavný kontakt v jednej transakcii zruší predchádzajúci hlavný kontakt", async () => {
  const form = new FormData();
  form.set("name", "Ján Včelár");
  form.set("role", "Majiteľ");
  form.set("isPrimary", "on");

  await expect(createSupplierContact("supplier-1", {}, form)).resolves.toEqual({
    success: "Kontakt bol pridaný.",
  });
  expect(mocks.contactUpdateMany).toHaveBeenCalledWith({
    where: { supplierId: "supplier-1" },
    data: { isPrimary: false },
  });
  expect(mocks.contactCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ supplierId: "supplier-1", isPrimary: true }),
  });
});

test("bankový účet nemôže pridať bežný používateľ", async () => {
  mocks.requireUser.mockResolvedValue({
    userId: "user-1",
    email: "user@zdravyshot.sk",
    role: "user",
  });
  const form = new FormData();
  form.set("iban", "SK3112000000198742637541");

  await expect(createSupplierBankAccount("supplier-1", {}, form)).resolves.toEqual({
    error: "Bankové účty môže meniť iba finančný administrátor.",
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});
