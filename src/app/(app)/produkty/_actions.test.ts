import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { create: mocks.create, update: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createProduct, updateProduct } from "./_actions";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    sku: "ZS-PAS-KLA-060", name: "Pasterizovaný shot 60 ml", volumeMl: "60",
    priceB2c: "3,50", priceB2b: "2,70", vatRate: "0", shelfLifeDays: "90",
    isActive: "on", ...overrides,
  })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: "user-1" });
  mocks.create.mockResolvedValue({ id: "product-1" });
});

test("nový aktívny produkt uloží ceny v centoch a sprístupní katalóg objednávke", async () => {
  await createProduct({}, form());
  expect(mocks.create).toHaveBeenCalledWith({
    data: {
      sku: "ZS-PAS-KLA-060", name: "Pasterizovaný shot 60 ml", volumeMl: 60,
      priceB2cCents: 350, priceB2bCents: 270, vatRate: 0,
      shelfLifeDays: 90, isActive: true, unit: "ks",
    }, select: { id: true },
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/objednavky/nova");
  expect(mocks.redirect).toHaveBeenCalledWith("/produkty/product-1/upravit?ulozene=1");
});

test("neplatný objem alebo cena produkt neuložia", async () => {
  expect((await createProduct({}, form({ volumeMl: "0" }))).error).toMatch(/Objem/);
  expect((await createProduct({}, form({ priceB2c: "-1,00" }))).error).toMatch(/Predajná cena/);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("úprava umožní deaktivovať produkt bez zmazania", async () => {
  const data = form();
  data.delete("isActive");
  await updateProduct("product-1", {}, data);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "product-1" }, data: expect.objectContaining({ isActive: false }),
  }));
});
