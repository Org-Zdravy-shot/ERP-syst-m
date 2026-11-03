import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { card, table, thead, th, td, tr } from "@/components/ui";
import { christmasOriginLabels, christmasOrderStatusLabels } from "@/lib/zod-schemas";
import { CampaignNav, euro } from "../_ui";

export default async function History({ searchParams }: { searchParams: Promise<{ kampan?: string; hladat?: string; stav?: string; povod?: string }> }) {
  await requireFinancePermission("VIEW");
  const p = await searchParams;
  const campaign = await prisma.christmasCampaign.findFirst({ where: { id: p.kampan, legalEntity: "KURGI" } });
  if (!campaign) throw new Error("Vyberte kampaň.");
  const orders = await prisma.christmasOrder.findMany({ where: { campaignId: campaign.id, legalEntity: "KURGI", ...(p.stav ? { status: p.stav } : {}), ...(p.povod ? { origin: p.povod } : {}), ...(p.hladat ? { OR: [{ number: { contains: p.hladat, mode: "insensitive" } }, { client: { name: { contains: p.hladat, mode: "insensitive" } } }] } : {}) }, include: { client: true, snapshots: { orderBy: { revision: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 200 });
  return <><PageHeader title="História vianočných kalkulácií" subtitle={campaign.name} /><CampaignNav campaignId={campaign.id} /><form method="get" className={`${card} mb-4 flex flex-wrap gap-2 p-4`}><input type="hidden" name="kampan" value={campaign.id} /><input name="hladat" defaultValue={p.hladat} placeholder="Číslo alebo klient" className="rounded-lg border p-2 text-sm" /><select name="stav" defaultValue={p.stav ?? ""} className="rounded-lg border p-2 text-sm"><option value="">Všetky stavy</option>{Object.entries(christmasOrderStatusLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><select name="povod" defaultValue={p.povod ?? ""} className="rounded-lg border p-2 text-sm"><option value="">Všetky pôvody</option>{Object.entries(christmasOriginLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><button className="rounded-lg bg-stone-950 px-4 py-2 text-sm text-white">Filtrovať</button></form><div className={`${card} overflow-x-auto`}><table className={table}><thead className={thead}><tr><th className={th}>Číslo</th><th className={th}>Klient</th><th className={th}>Stav</th><th className={th}>Pôvod</th><th className={th}>Revízia</th><th className={th}>Deliteľný zisk</th></tr></thead><tbody>{orders.map(o => <tr key={o.id} className={tr}><td className={td}><Link href={`/vianocna-b2b/kalkulacie/${o.id}`} className="underline">{o.number}</Link></td><td className={td}>{o.client.name}</td><td className={td}>{christmasOrderStatusLabels[o.status as keyof typeof christmasOrderStatusLabels]}</td><td className={td}>{christmasOriginLabels[o.origin as keyof typeof christmasOriginLabels]}</td><td className={td}>{o.currentRevision}</td><td className={td}>{euro(o.snapshots[0]?.divisibleProfitCents ?? 0)}</td></tr>)}</tbody></table></div></>;
}
