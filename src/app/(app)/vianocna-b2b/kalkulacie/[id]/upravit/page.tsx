import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import type { CalculationInput } from "@/lib/christmas/engine";
import { CalculationForm } from "../../../CalculationForm";
import { CampaignNav } from "../../../_ui";
import { getConfiguration } from "../../../_actions";

export default async function EditCalculation({ params }: { params: Promise<{ id: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { id } = await params;
  const order = await prisma.christmasOrder.findFirst({ where: { id, legalEntity: "KURGI", status: "DRAFT", campaign: { status: "OPEN" } }, include: { snapshots: { orderBy: { revision: "desc" }, take: 1 }, attribution: true, campaign: true } });
  if (!order || !order.snapshots[0]) throw new Error("Rozpracovaná kalkulácia neexistuje.");
  const { config } = await getConfiguration(order.campaignId);
  const clients = await prisma.client.findMany({ where: { type: "B2B", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const initial = { clientId: order.clientId, contactName: order.contactName, deliveryDate: order.deliveryDate?.toISOString().slice(0,10), note: order.note, leadId: order.attribution?.leadId, source: order.attribution?.source, sourceCampaign: order.attribution?.sourceCampaign, crmReference: order.attribution?.crmReference, attributionNote: order.attribution?.note, input: order.snapshots[0].input as CalculationInput };
  return <><PageHeader title={`Upraviť ${order.number}`} subtitle="Uložením vznikne nová revízia." /><CampaignNav campaignId={order.campaignId} /><CalculationForm campaignId={order.campaignId} clients={clients} initial={initial} orderId={order.id} expectedRevision={order.currentRevision} defaultVatRate={config.outputVatRate} /></>;
}
