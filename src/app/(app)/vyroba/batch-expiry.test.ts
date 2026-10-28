import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), product: vi.fn(), transaction: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findUnique: mocks.product }, $transaction: mocks.transaction } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createBatch } from "./_actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: "user" });
});

test("neodvodí exspiráciu z historicky zadaných 220 dní bez potvrdenia trvanlivosti", async () => {
  mocks.product.mockResolvedValue({ id: "shot-60", shelfLifeDays: 220, shelfLifeConfirmedAt: null });
  const data = new FormData(); data.set("productId", "shot-60"); data.set("producedQty", "150"); data.set("productionDate", "2026-10-23");
  const result = await createBatch({}, data);
  expect(result.error).toMatch(/trvanlivosť produktu zatiaľ nie je potvrdená/);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
