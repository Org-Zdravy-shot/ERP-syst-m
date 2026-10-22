import { describe, expect, it } from "vitest";
import { allocateProductStock, InsufficientProductStockError } from "./stock-allocation";

const today = new Date("2026-10-22T00:00:00.000Z");

describe("allocateProductStock", () => {
  it("expeduje najprv šaržu s najbližšou exspiráciou a až potom nepriradené kusy", () => {
    const result = allocateProductStock([
      { batchId: "later", expiryDate: new Date("2026-11-30"), quantity: 4 },
      { batchId: "sooner", expiryDate: new Date("2026-10-22"), quantity: 3 },
    ], 2, 8, today);
    expect(result).toEqual([
      { batchId: "sooner", quantity: 3 },
      { batchId: "later", quantity: 4 },
      { batchId: null, quantity: 1 },
    ]);
  });

  it("neexpeduje exspirované kusy ani keď celkový sklad vyzerá dostatočný", () => {
    expect(() => allocateProductStock([
      { batchId: "old", expiryDate: new Date("2026-10-21"), quantity: 8 },
      { batchId: "new", expiryDate: new Date("2026-10-30"), quantity: 2 },
    ], 0, 3, today)).toThrow(InsufficientProductStockError);
  });

  it("pri historickom výdaji bez šarže nevytvorí zavádzajúcu šaržovú stopu", () => {
    const result = allocateProductStock([
      { batchId: "lot", expiryDate: new Date("2026-11-01"), quantity: 10 },
    ], -4, 5, today);
    expect(result).toEqual([{ batchId: null, quantity: 5 }]);
    expect(() => allocateProductStock([
      { batchId: "lot", expiryDate: new Date("2026-11-01"), quantity: 10 },
    ], -4, 7, today)).toThrow(InsufficientProductStockError);
  });
});
