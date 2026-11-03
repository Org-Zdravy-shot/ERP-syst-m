export const NEXT_CHRISTMAS_STATUSES: Record<string, readonly string[]> = {
  DRAFT: ["QUOTE_APPROVED", "CANCELLED"],
  QUOTE_APPROVED: ["DRAFT", "QUOTE_SENT", "CANCELLED"],
  QUOTE_SENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["INVOICED", "CANCELLED"],
  INVOICED: ["PAID", "CANCELLED"],
  PAID: ["REFUNDED"],
};
export function canTransitionChristmasOrder(from: string, to: string) {
  return NEXT_CHRISTMAS_STATUSES[from]?.includes(to) ?? false;
}
export function isCommercialChristmasOrder(order: { status: string; paidAt?: Date | null; refundedAt?: Date | null; cancelledAt?: Date | null }) {
  return !order.cancelledAt && !order.refundedAt &&
    (order.status === "CONFIRMED" || order.status === "INVOICED" || (order.status === "PAID" && Boolean(order.paidAt)));
}
export function isSettlementEligible(order: { status: string; origin: string; paidAt?: Date | null; refundedAt?: Date | null; cancelledAt?: Date | null }) {
  return order.status === "PAID" && order.origin === "AGENCY" && Boolean(order.paidAt) && !order.refundedAt && !order.cancelledAt;
}
