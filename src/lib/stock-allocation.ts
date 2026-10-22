/** Výber identifikovaných šarží pri expedícii. Nepriradený historický stav zostáva označený ako neznámy. */
export interface BatchPool {
  batchId: string;
  expiryDate: Date;
  quantity: number;
}

export interface StockAllocation {
  batchId: string | null;
  quantity: number;
}

export class InsufficientProductStockError extends Error {
  constructor(public readonly available: number) {
    super("Na expedíciu nie je dostatok neexspirovaných zásob.");
  }
}

export function allocateProductStock(
  batches: readonly BatchPool[],
  unassignedQuantity: number,
  demand: number,
  earliestValidExpiry: Date,
): StockAllocation[] {
  if (!Number.isSafeInteger(demand) || demand <= 0) throw new Error("Množstvo musí byť kladný počet kusov.");

  const validBatches = batches
    .filter((batch) => batch.quantity > 0 && batch.expiryDate >= earliestValidExpiry)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || a.batchId.localeCompare(b.batchId));
  const total = batches.reduce((sum, batch) => sum + batch.quantity, unassignedQuantity);
  const eligible = Math.max(0, validBatches.reduce((sum, batch) => sum + batch.quantity, unassignedQuantity));
  const available = Math.max(0, Math.min(total, eligible));
  if (available + 1e-9 < demand) throw new InsufficientProductStockError(available);

  // Staré záporné pohyby bez šarže znemožňujú spoľahlivo určiť zvyšok jednotlivých šarží.
  // Výdaj preto ostane nepriradený, kým sa historický stav fyzicky nezreviduje.
  if (unassignedQuantity < 0) return [{ batchId: null, quantity: demand }];

  const result: StockAllocation[] = [];
  let remaining = demand;
  for (const batch of validBatches) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, batch.quantity);
    result.push({ batchId: batch.batchId, quantity });
    remaining -= quantity;
  }
  if (remaining > 0) result.push({ batchId: null, quantity: remaining });
  return result;
}
