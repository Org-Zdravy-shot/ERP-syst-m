import { prisma } from "@/lib/prisma";
import { requireFinancePermission, hasFinancePermission } from "@/lib/finance/permissions";
import { adNetCents } from "@/lib/christmas/dashboard";
import { PageHeader } from "@/components/PageHeader";
import { card, table, thead, th, td, tr, btnSecondary } from "@/components/ui";
import { CampaignNav, euro } from "../_ui";
import { voidAdExpense } from "../_actions";
import { AdForm } from "./AdForm";

export default async function Ads({ searchParams }: { searchParams: Promise<{ kampan?: string }> }) {
  const user = await requireFinancePermission("VIEW");
  const { kampan } = await searchParams;
  const campaign = await prisma.christmasCampaign.findFirst({ where: { id: kampan, legalEntity: "KURGI" } });
  if (!campaign) throw new Error("Vyberte kampaň.");
  const [ads, orders] = await Promise.all([
    prisma.christmasAdExpense.findMany({ where: { campaignId: campaign.id }, include: { order: { select: { number: true } } }, orderBy: { spentAt: "desc" } }),
    prisma.christmasOrder.findMany({ where: { campaignId: campaign.id }, select: { id: true, number: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return <><PageHeader title="Dodatočné reklamné náklady" subtitle="Odpočítavajú sa až od podielu Zdravého Shotu." /><CampaignNav campaignId={campaign.id} />{campaign.status === "OPEN" && hasFinancePermission(user.role, "CREATE_DRAFT") && <AdForm campaignId={campaign.id} orders={orders} />}<div className={`${card} overflow-x-auto`}><table className={table}><thead className={thead}><tr><th className={th}>Dátum</th><th className={th}>Platforma</th><th className={th}>Názov</th><th className={th}>Náklad bez odpočítateľnej DPH</th><th className={th}>Objednávka</th><th className={th}>Oprava</th></tr></thead><tbody>{ads.map(a => <tr className={tr} key={a.id}><td className={td}>{a.spentAt.toLocaleDateString("sk-SK")}</td><td className={td}>{a.platform}</td><td className={td}>{a.name}</td><td className={td}>{a.voidedAt ? <s>{euro(adNetCents(a))}</s> : euro(adNetCents(a))}</td><td className={td}>{a.order?.number ?? "Len kampaň"}</td><td className={td}>{a.voidedAt ? `Zrušený: ${a.voidReason}` : campaign.status === "OPEN" && hasFinancePermission(user.role, "CANCEL") ? <form action={voidAdExpense.bind(null, campaign.id, a.id)} className="flex gap-1"><input name="reason" required minLength={5} maxLength={500} placeholder="Dôvod opravy" className="w-32 rounded-lg border p-1 text-xs" /><button className={btnSecondary}>Zrušiť zápis</button></form> : "—"}</td></tr>)}</tbody></table></div></>;
}
