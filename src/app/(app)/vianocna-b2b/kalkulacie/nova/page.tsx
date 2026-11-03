import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import type { CalculationInput } from "@/lib/christmas/engine";
import { CalculationForm } from "../../CalculationForm";
import { CampaignNav } from "../../_ui";
import { getConfiguration } from "../../_actions";

export default async function NewCalculation({ searchParams }: { searchParams: Promise<{ kampan?: string; duplikat?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { kampan, duplikat } = await searchParams;
  const campaign = await prisma.christmasCampaign.findFirst({ where: { id: kampan, legalEntity: "KURGI", status: "OPEN" } });
  if (!campaign) throw new Error("Vyberte otvorenú kampaň v prehľade.");
  const { config } = await getConfiguration(campaign.id);
  const [clients, source] = await Promise.all([prisma.client.findMany({ where: { type: "B2B", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }), duplikat ? prisma.christmasOrder.findFirst({ where: { id: duplikat, campaignId: campaign.id, legalEntity: "KURGI" }, include: { snapshots: { orderBy: { revision: "desc" }, take: 1 }, attribution: true } }) : Promise.resolve(null)]);
  const initial = source?.snapshots[0] ? { clientId: source.clientId, contactName: source.contactName, deliveryDate: source.deliveryDate?.toISOString().slice(0,10), note: source.note, leadId: source.attribution?.leadId, source: source.attribution?.source, sourceCampaign: source.attribution?.sourceCampaign, crmReference: source.attribution?.crmReference, attributionNote: source.attribution?.note, input: source.snapshots[0].input as CalculationInput } : undefined;
  return <><PageHeader title={source ? "Duplikovať kalkuláciu" : "Nová vianočná kalkulácia"} subtitle={campaign.name} /><CampaignNav campaignId={campaign.id} /><CalculationForm campaignId={campaign.id} clients={clients} initial={initial} defaultVatRate={config.outputVatRate} /></>;
}
