import { prisma } from "@/lib/prisma";
import { requireFinancePermission, hasFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, card, table, thead, th, td, tr } from "@/components/ui";
import { CampaignNav, Stat, euro } from "../_ui";
import { closeSettlement } from "../_actions";
import { SettlementExport } from "./SettlementExport";
import { isSettlementEligible } from "@/lib/christmas/status";

export default async function Settlement({ searchParams }: { searchParams: Promise<{ kampan?: string }> }) {
  const user = await requireFinancePermission("VIEW");
  const { kampan } = await searchParams;
  const campaign = await prisma.christmasCampaign.findFirst({ where: { id: kampan, legalEntity: "KURGI" }, include: { settlements: true } });
  if (!campaign) throw new Error("Vyberte kampaň.");
  const sealed = campaign.settlements[0];
  const orders = sealed ? [] : (await prisma.christmasOrder.findMany({ where: { campaignId: campaign.id, legalEntity: "KURGI", status: "PAID", paidAt: { not: null }, cancelledAt: null, refundedAt: null, origin: "AGENCY" }, include: { client: { select: { name: true } }, snapshots: { orderBy: { revision: "desc" }, take: 1 } }, orderBy: { number: "asc" } })).filter(isSettlementEligible);
  const rows = sealed ? (sealed.includedOrders as { number: string; client: string; agencyShareCents: number; companyShareCents: number }[]).map(r => ({ number: r.number, client: r.client, agencyCents: r.agencyShareCents, companyCents: r.companyShareCents })) : orders.map(o => ({ number: o.number, client: o.client.name, agencyCents: o.snapshots[0]?.agencyShareCents ?? 0, companyCents: o.snapshots[0]?.companyShareCents ?? 0 }));
  const canClose = Boolean(campaign.endsAt && campaign.endsAt.getTime() <= Date.now());
  return <><PageHeader title="Vyúčtovanie agentúry" subtitle="Iba zaplatené a nevrátené zákazky získané agentúrou" /><CampaignNav campaignId={campaign.id} /><div className="mb-5 grid gap-3 md:grid-cols-3"><Stat label="Oprávnené objednávky" value={String(rows.length)} /><Stat label={sealed ? "Uzavretý podiel agentúry" : "Predbežný podiel agentúry"} value={euro(rows.reduce((n,r) => n + r.agencyCents, 0))} /><Stat label="Podiel Zdravého Shotu" value={euro(rows.reduce((n,r) => n + r.companyCents, 0))} /></div>{sealed ? <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm">Vyúčtovanie bolo nemenne uzavreté {sealed.createdAt.toLocaleDateString("sk-SK")}. Platba agentúre sa tým nespustila.</p> : <p className="mb-4 rounded-xl bg-amber-50 p-4 text-sm">Náhľad vychádza z aktuálneho stavu. Stornované, refundované, vlastné a neoverené zákazky nie sú zahrnuté. {!canClose && "Na uzavretie potvrďte v nastaveniach skutočný koniec kampane."}</p>}<div className="mb-4 flex gap-2"><SettlementExport rows={rows} />{!sealed && hasFinancePermission(user.role, "FINALIZE") && <form action={closeSettlement.bind(null, campaign.id)}><button disabled={!canClose} className={btnPrimary}>Nemenné uzavretie kampane</button></form>}</div><div className={`${card} overflow-x-auto`}><table className={table}><thead className={thead}><tr><th className={th}>Objednávka</th><th className={th}>Klient</th><th className={th}>Agentúra</th><th className={th}>Zdravý Shot</th></tr></thead><tbody>{rows.map(r => <tr className={tr} key={r.number}><td className={td}>{r.number}</td><td className={td}>{r.client}</td><td className={td}>{euro(r.agencyCents)}</td><td className={td}>{euro(r.companyCents)}</td></tr>)}</tbody></table></div></>;
}
