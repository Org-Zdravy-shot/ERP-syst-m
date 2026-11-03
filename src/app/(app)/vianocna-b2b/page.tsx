import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { campaignDashboard } from "@/lib/christmas/dashboard";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, card, table, thead, th, td, tr } from "@/components/ui";
import { christmasOriginLabels, christmasOrderStatusLabels } from "@/lib/zod-schemas";
import { CampaignNav, Stat, euro } from "./_ui";
import { createCampaign2026 } from "./_actions";
import { ExportButton } from "./ExportButton";
import { Prisma } from "@prisma/client";

export default async function ChristmasDashboard({ searchParams }: { searchParams: Promise<{ kampan?: string; povod?: string; stav?: string; klient?: string; od?: string; do?: string; produkt?: string; balenie?: string }> }) {
  const user = await requireFinancePermission("VIEW");
  const params = await searchParams;
  const campaigns = await prisma.christmasCampaign.findMany({ where: { legalEntity: "KURGI" }, orderBy: [{ year: "desc" }, { createdAt: "desc" }] });
  const campaign = campaigns.find(c => c.id === params.kampan) ?? campaigns[0];
  if (!campaign) return <><PageHeader title="Vianočná B2B kampaň" subtitle="Samostatná ekonomika vianočných firemných objednávok" /><div className={`${card} p-6`}><p className="mb-4 text-sm text-stone-600">Zatiaľ nie je založená žiadna kampaň.</p>{["admin", "FINANCE_ADMIN"].includes(user.role) && <form action={createCampaign2026}><button className={btnPrimary}>Založiť kampaň 2026</button></form>}</div></>;
  const filters = { origin: ["AGENCY", "OWN", "UNKNOWN"].includes(params.povod ?? "") ? params.povod : undefined, status: params.stav && params.stav in christmasOrderStatusLabels ? params.stav : undefined, clientId: params.klient || undefined, from: params.od ? new Date(`${params.od}T00:00:00Z`) : undefined, to: params.do ? new Date(`${params.do}T23:59:59Z`) : undefined, sku: params.produkt || undefined, packageKind: params.balenie || undefined };
  const [dashboard, clients] = await Promise.all([campaignDashboard(campaign.id, filters), prisma.client.findMany({ where: { type: "B2B", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const s = dashboard.stats;
  return <>
    <PageHeader title="Vianočná B2B kampaň" subtitle={`${campaign.name} · ${campaign.status === "OPEN" ? "Otvorená" : "Uzavretá"}`}><Link className={btnPrimary} href={`/vianocna-b2b/kalkulacie/nova?kampan=${campaign.id}`}>+ Nová kalkulácia</Link></PageHeader>
    <CampaignNav campaignId={campaign.id} />
    <form method="get" className={`${card} mb-5 grid grid-cols-2 gap-3 p-4 text-sm lg:grid-cols-4`}>
      <label>Kampaň<select name="kampan" defaultValue={campaign.id} className="mt-1 w-full rounded-lg border p-2">{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Pôvod<select name="povod" defaultValue={filters.origin ?? ""} className="mt-1 w-full rounded-lg border p-2"><option value="">Všetky</option>{Object.entries(christmasOriginLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Stav<select name="stav" defaultValue={filters.status ?? ""} className="mt-1 w-full rounded-lg border p-2"><option value="">Všetky</option>{Object.entries(christmasOrderStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Klient<select name="klient" defaultValue={params.klient ?? ""} className="mt-1 w-full rounded-lg border p-2"><option value="">Všetci</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Od<input type="date" name="od" defaultValue={params.od} className="mt-1 w-full rounded-lg border p-2" /></label><label>Do<input type="date" name="do" defaultValue={params.do} className="mt-1 w-full rounded-lg border p-2" /></label>
      <label>Produkt<select name="produkt" defaultValue={params.produkt ?? ""} className="mt-1 w-full rounded-lg border p-2"><option value="">Všetky</option><option value="GINGER_60">Zázvor 60 ml</option><option value="GINGER_200">Zázvor 200 ml</option><option value="PINEAPPLE_60">Ananás 60 ml</option><option value="PINEAPPLE_200">Ananás 200 ml</option></select></label>
      <label>Balenie<select name="balenie" defaultValue={params.balenie ?? ""} className="mt-1 w-full rounded-lg border p-2"><option value="">Všetky</option><option value="TWO_60">2 × 60 ml</option><option value="ONE_200">1 × 200 ml</option><option value="CUSTOM">Vlastné</option><option value="OTHER">Iné</option></select></label>
      <button className={btnSecondary}>Filtrovať</button><ExportButton campaignId={campaign.id} filters={filters} />
    </form>
    <h2 className="mb-2 text-lg font-semibold">Obchod</h2><div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">{[["Leady", s.leadCount], ["Kalkulácie", s.calculationCount], ["Odoslané ponuky", s.quoteSentCount], ["Potvrdené objednávky", s.confirmedCount], ["Zaplatené", s.paidCount], ["Stornované", s.cancelledCount], ["Shoty", s.shots], ["Darčekové balenia", s.packages], ["Litre", s.liters.toFixed(2)], ["Priemerná objednávka", euro(s.confirmedCount ? Math.round(s.revenueNetCents / s.confirmedCount) : 0)]].map(([label, value]) => <Stat key={label} label={String(label)} value={String(value)} />)}</div>
    <h2 className="mb-2 text-lg font-semibold">Ekonomika potvrdených objednávok · pred daňou z príjmov</h2><div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Tržby bez DPH" value={euro(s.revenueNetCents)} /><Stat label="Tržby s DPH" value={euro(s.revenueGrossCents)} /><Stat label="Priame výrobné náklady" value={euro(s.directCostCents)} /><Stat label="Modelovo alokovaná réžia" value={euro(s.overheadCents)} /><Stat label="Ostatné náklady" value={euro(s.otherCostCents)} /><Stat label="Deliteľný zisk" value={euro(s.divisibleProfitCents)} strong /><Stat label="Marža" value={s.revenueNetCents ? `${new Prisma.Decimal(s.divisibleProfitCents).div(s.revenueNetCents).mul(100).toFixed(2)} %` : "—"} /><Stat label="Podiel agentúry" value={euro(s.agencyShareCents)} /><Stat label="Podiel Zdravého Shotu" value={euro(s.companyShareCents)} /><Stat label="Dodatočná reklama" value={euro(s.adTotalCents)} hint={`Z toho nepriradená: ${euro(s.unassignedAdCents)}`} /><Stat label="Efektívny výsledok ZS po reklame" value={euro(s.effectiveCompanyCents)} strong /></div>
    <h2 className="mb-2 text-lg font-semibold">Pôvod zákaziek</h2><div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">{Object.entries(christmasOriginLabels).map(([key, name]) => { const o = s.origin[key] as { count: number; profitCents: number; agencyCents: number }; return <div key={key} className={`${card} p-4`}><strong>{name}</strong><div className="mt-2 text-sm">{o.count} zákaziek · deliteľný zisk {euro(o.profitCents)}</div><div className="text-sm">Agentúra {euro(o.agencyCents)}</div></div>; })}</div>
    <h2 className="mb-2 text-lg font-semibold">Posledné kalkulácie</h2><div className={`${card} overflow-x-auto`}><table className={table}><thead className={thead}><tr><th className={th}>Číslo</th><th className={th}>Klient</th><th className={th}>Pôvod</th><th className={th}>Stav</th><th className={th}>Tržby bez DPH</th><th className={th}>Deliteľný zisk</th></tr></thead><tbody>{dashboard.orders.slice(0, 20).map(o => <tr key={o.id} className={tr}><td className={td}><Link className="underline" href={`/vianocna-b2b/kalkulacie/${o.id}`}>{o.number}</Link></td><td className={td}>{o.client.name}</td><td className={td}>{christmasOriginLabels[o.origin as keyof typeof christmasOriginLabels]}</td><td className={td}>{christmasOrderStatusLabels[o.status as keyof typeof christmasOrderStatusLabels]}</td><td className={td}>{euro(o.snapshots[0]?.revenueNetCents ?? 0)}</td><td className={td}>{euro(o.snapshots[0]?.divisibleProfitCents ?? 0)}</td></tr>)}</tbody></table></div>
  </>;
}
