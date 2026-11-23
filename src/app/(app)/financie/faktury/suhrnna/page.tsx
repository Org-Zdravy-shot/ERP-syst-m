import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, input, label } from "@/components/ui";
import { legalEntityLabels } from "@/lib/zod-schemas";
import { computeTotals } from "@/lib/invoicing";
import { slovakDateKey } from "../../../objednavky/pricing";
import { ConsolidatedInvoiceForm } from "./ConsolidatedInvoiceForm";

export default async function ConsolidatedInvoicePage({ searchParams }: { searchParams: Promise<{ klient?: string; subjekt?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const params = await searchParams;
  const entity = params.subjekt === "KURGI" || params.subjekt === "SOLE_TRADER" ? params.subjekt : undefined;
  const clientId = typeof params.klient === "string" ? params.klient.slice(0, 100) : undefined;
  const clients = await prisma.client.findMany({ where: { isActive: true }, select: { id: true, name: true, ico: true }, orderBy: { name: "asc" } });
  const orders = clientId && entity ? await prisma.order.findMany({ where: {
    clientId, legalEntity: entity, status: { not: "ZRUSENA" },
    OR: [{ status: "DORUCENA" }, { shipmentStatus: "DELIVERED_EXTERNALLY" }],
    invoices: { none: { direction: "VYDANA", documentType: "INVOICE", documentStatus: { not: "CANCELLED" } } },
    invoiceOrders: { none: { invoice: { direction: "VYDANA", documentType: "INVOICE", documentStatus: { not: "CANCELLED" } } } },
    deliveryNotes: { none: { cancelledAt: null } },
  }, include: { items: true, charges: true }, orderBy: [{ orderDate: "desc" }, { id: "asc" }], take: 201 }) : [];
  return <>
    <PageHeader title="Súhrnná faktúra" subtitle="Viac doručených objednávok jedného odberateľa na jednom doklade">
      <Link href="/financie/faktury" className={btnSecondary}>← Faktúry</Link>
    </PageHeader>
    <form className="mb-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-[1fr_1fr_auto]">
      <label className={label}>Odberateľ<select className={input} name="klient" defaultValue={clientId ?? ""} required><option value="">Vyberte odberateľa</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.ico ? ` · ${c.ico}` : ""}</option>)}</select></label>
      <label className={label}>Právny subjekt<select className={input} name="subjekt" defaultValue={entity ?? ""} required><option value="">Vyberte subjekt</option>{Object.entries(legalEntityLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <button className={`${btnSecondary} self-end mb-1.5`}>Zobraziť objednávky</button>
    </form>
    {clientId && entity ? <>
      <p className="mb-4 text-sm text-stone-600">Vyberte celé doručené objednávky z jedného kalendárneho mesiaca. Pri každej potvrďte skutočný dátum dodania a číslo objednávky odberateľa. Uložením vznikne koncept na kontrolu.</p>
      {orders.length > 200 && <p className="mb-4 text-sm text-amber-800">Zobrazených je 200 najnovších nevyfakturovaných objednávok.</p>}
      <ConsolidatedInvoiceForm key={`${clientId}-${entity}`} today={slovakDateKey()} orders={orders.slice(0, 200).map(o => ({
        id: o.id, orderNumber: o.orderNumber, expectedUpdatedAt: o.updatedAt.toISOString(), orderDate: slovakDateKey(o.orderDate),
        deliveryDate: o.deliveredAt ? slovakDateKey(o.deliveredAt) : "", totalGrossCents: computeTotals([...o.items, ...o.charges.filter(c => c.includedInSellerTotal).map(c => ({ ...c, quantity: 1 }))]).totalGrossCents,
      }))} />
    </> : <p className="text-sm text-stone-600">Vyberte odberateľa a subjekt, za ktorý budete fakturovať.</p>}
  </>;
}
