/** Restores a local order draft and appends a product created during the order flow. */
import { formatUnitPrice } from "@/lib/precise-price";

export function storedOrderPriceInput(item: { unitPriceCents: number; unitPriceExact?: string | { toString(): string } | null }): string {
  return item.unitPriceExact ? formatUnitPrice(String(item.unitPriceExact)) : (item.unitPriceCents / 100).toFixed(2).replace(".", ",");
}

export function restoreOrderDraft<T extends { rows: Array<{ productId: string }>; submissionKey: string }>(
  initial: T,
  stored: string | null,
  newProductId: string | undefined,
  makeRow: (productId: string, draft: T) => T["rows"][number],
): T {
  let draft = initial;
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as T;
      if (parsed && Array.isArray(parsed.rows)) draft = { ...initial, ...parsed };
    } catch { /* ignore a damaged local draft */ }
  }
  if (newProductId && !draft.rows.some((row) => row.productId === newProductId)) {
    const row = makeRow(newProductId, draft);
    draft = { ...draft, rows: draft.rows.length === 1 && !draft.rows[0].productId ? [row] : [...draft.rows, row] };
  }
  return draft;
}

export function repriceDraftRows<T extends { productId: string; manual?: boolean; priceEur: string; priceSource: string }>(
  rows: T[],
  resolve: (productId: string) => { priceEur: string; priceSource: string } | null,
): T[] {
  return rows.map((row) => {
    if (!row.productId || row.manual) return row;
    const price = resolve(row.productId);
    return { ...row, priceEur: price?.priceEur ?? "", priceSource: price?.priceSource ?? row.priceSource, manual: false };
  });
}
