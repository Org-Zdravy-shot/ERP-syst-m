import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import { OverviewChart } from "./OverviewChart";
import { buildOverview } from "./overview-data";
import { invoiceListHref, overviewInvoiceScope, parseInvoiceFilters } from "./faktury/list-filters";
import { slovakDateKey } from "../objednavky/pricing";

export default async function FinanciePage({ searchParams }: { searchParams: Promise<{ subjekt?: string; rok?: string }> }) {
  const today = slovakDateKey();
  const currentYear = Number(today.slice(0, 4));
  const filters = parseInvoiceFilters(await searchParams, currentYear);
  const year = Number(filters.rok ?? currentYear);
  const entity = filters.subjekt;
  const entityWhere = entity ? { legalEntity: entity === "UNASSIGNED" ? null : entity } : {};
  const [documents, open, latest, drafts] = await Promise.all([
    prisma.invoice.findMany({ where: { ...entityWhere, ...overviewInvoiceScope, issueDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, select: { direction: true, documentType: true, source: true, issueDate: true, totalNetCents: true, totalGrossCents: true, paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } } } }),
    prisma.invoice.findMany({ where: { ...entityWhere, direction: "VYDANA", documentType: "INVOICE", documentStatus: "ISSUED", currency: "EUR", source: { not: "HISTORICAL" } }, select: { id: true, invoiceNumber: true, totalGrossCents: true, dueDate: true, client: { select: { name: true } }, paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } } }, orderBy: { dueDate: "asc" } }),
    prisma.invoice.findMany({ where: { ...entityWhere, currency: "EUR" }, select: { id: true, direction: true, invoiceNumber: true, externalNumber: true, documentStatus: true, totalGrossCents: true, issueDate: true, client: { select: { name: true } }, supplierName: true }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.invoice.count({ where: { ...entityWhere, direction: "VYDANA", documentStatus: "DRAFT", source: { not: "HISTORICAL" } } }),
  ]);
  const unpaid = open.map(i => ({ ...i, remaining: Math.max(0, i.totalGrossCents - i.paymentAllocations.reduce((sum, p) => sum + p.amountCents, 0)) })).filter(i => i.remaining > 0);
  const overdue = unpaid.filter(i => i.dueDate.toISOString().slice(0, 10) < today);
  const periodHref = (value: number) => `/financie?${new URLSearchParams({ rok: String(value), ...(entity ? { subjekt: entity } : {}) })}`;
  const listHref = (extra: Record<string, string>) => invoiceListHref({ subjekt: entity, ...extra });
  const detailHref = (id: string, direction: string) => {
    const params = new URLSearchParams({ smer: direction, ...(entity ? { subjekt: entity } : {}) });
    return `/financie/faktury/${id}?${params}`;
  };
  return <>
    <div className="finance-overview-heading"><h1>Prehľady fakturácie</h1></div>
    <section className="finance-report">
      <div className="finance-report-tabs">
        <h2>Výsledky za rok</h2>
        <nav className="finance-year-nav" aria-label="Rok prehľadu">
          {year > 2010 && <Link href={periodHref(year - 1)} aria-label="Predchádzajúci rok">‹</Link>}
          <strong>{year}</strong>
          {year <= currentYear && <Link href={periodHref(year + 1)} aria-label="Nasledujúci rok">›</Link>}
        </nav>
      </div>
      <OverviewChart data={buildOverview(documents, year)} year={year} entity={entity} />
    </section>
    <p className="finance-data-note">Prehľad dokladov v EUR podľa vystavenia, vrátane dobropisov. Saldo vychádza z úhrad priradených v ERP. Pri historických dokladoch s odlišnou menou dane môže suma bez DPH chýbať. <Link href={entity ? `/financie/marze?subjekt=${entity}` : "/financie/marze"}>eKasa, platby a marže →</Link> · <Link href="/objednavky/inbox">Inbox objednávok →</Link></p>
    <div className="finance-dashboard-panels">
      <section className="finance-panel"><header><h2>Čakajú na úhradu za všetky roky <span>{unpaid.length}</span></h2><Link href={listHref({ smer: "VYDANA", uhrada: "UNPAID", rozsah: "PREHLAD" })}>Zobraziť všetky →</Link></header><div className="finance-panel-total"><strong>{formatCents(unpaid.reduce((sum, i) => sum + i.remaining, 0))}</strong><span>{overdue.length} po splatnosti · {formatCents(overdue.reduce((sum, i) => sum + i.remaining, 0))}</span></div><div className="overflow-x-auto"><table><thead><tr><th>Faktúra / odberateľ</th><th>Splatnosť</th><th className="text-right">Zostáva</th></tr></thead><tbody>{unpaid.slice(0, 6).map(i => <tr key={i.id}><td><Link href={detailHref(i.id, "VYDANA")}>{i.invoiceNumber}</Link><small>{i.client?.name ?? "Odberateľ"}</small></td><td>{formatDate(i.dueDate)}</td><td className="text-right font-semibold">{formatCents(i.remaining)}</td></tr>)}{!unpaid.length && <tr><td colSpan={3} className="finance-empty">Žiadne neuhradené faktúry v evidencii.</td></tr>}</tbody></table></div></section>
      <section className="finance-panel"><header><h2>Posledné doklady</h2><Link href={listHref({})}>Všetky doklady →</Link></header><div className="overflow-x-auto"><table><thead><tr><th>Doklad / partner</th><th>Dátum</th><th className="text-right">Suma</th></tr></thead><tbody>{latest.map(i => <tr key={i.id}><td><Link href={detailHref(i.id, i.direction)}>{i.invoiceNumber ?? i.externalNumber ?? "Koncept faktúry"}</Link><small>{i.client?.name ?? i.supplierName ?? "Bez partnera"}</small></td><td>{formatDate(i.issueDate)}</td><td className="text-right font-semibold">{formatCents(i.totalGrossCents)}</td></tr>)}{!latest.length && <tr><td colSpan={3} className="finance-empty">Zatiaľ nemáte vytvorené doklady.</td></tr>}</tbody></table></div><footer><Link href={listHref({ smer: "VYDANA", stav: "DRAFT", zdroj: "INTERNA" })}>{drafts} rozpracovaných konceptov →</Link></footer></section>
    </div>
  </>;
}
