"use client";
import { useState } from "react";
import { exportDashboardCsv } from "./_actions";

export function ExportButton({ campaignId, filters }: { campaignId: string; filters: { origin?: string; status?: string; clientId?: string; from?: Date; to?: Date; sku?: string; packageKind?: string } }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" disabled={busy} className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium" onClick={async () => { setBusy(true); try { const csv = await exportDashboardCsv(campaignId, { ...filters, from: filters.from?.toISOString(), to: filters.to?.toISOString() }); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `vianocna-b2b-${campaignId}.csv`; a.click(); URL.revokeObjectURL(url); } finally { setBusy(false); } }}>{busy ? "Exportujem…" : "Export CSV"}</button>;
}
