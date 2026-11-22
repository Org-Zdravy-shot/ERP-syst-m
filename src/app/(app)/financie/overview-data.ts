export interface OverviewDocument {
  direction: string; documentType: string; source: string; issueDate: Date;
  totalNetCents: number; totalGrossCents: number; paymentAllocations: { amountCents: number }[];
}
export function buildOverview(documents: OverviewDocument[], year: number) {
  const months = Array.from({ length: 12 }, (_, month) => ({ month, revenueNet: 0, revenueGross: 0, expensesNet: 0, expensesGross: 0 }));
  let unpaidRevenue = 0, unpaidExpenses = 0, documentCount = 0;
  for (const doc of documents) {
    if (doc.issueDate.getUTCFullYear() !== year) continue;
    documentCount++;
    const month = months[doc.issueDate.getUTCMonth()], sign = doc.documentType === "CREDIT_NOTE" ? -1 : 1;
    const revenue = doc.direction === "VYDANA";
    if (revenue) { month.revenueNet += sign * doc.totalNetCents; month.revenueGross += sign * doc.totalGrossCents; }
    else { month.expensesNet += sign * doc.totalNetCents; month.expensesGross += sign * doc.totalGrossCents; }
    if (doc.documentType === "INVOICE" && doc.source !== "HISTORICAL") {
      const remaining = Math.max(0, doc.totalGrossCents - doc.paymentAllocations.reduce((sum, p) => sum + p.amountCents, 0));
      if (revenue) unpaidRevenue += remaining; else unpaidExpenses += remaining;
    }
  }
  return { months, unpaidRevenue, unpaidExpenses, documentCount };
}
