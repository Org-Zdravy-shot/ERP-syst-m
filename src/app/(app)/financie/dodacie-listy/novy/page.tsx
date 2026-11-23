import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { slovakDateKey } from "../../../objednavky/pricing";
import { invoiceFormOptions } from "../../faktury/form-options";
import { DeliveryNoteForm } from "./DeliveryNoteForm";

export default async function NewDeliveryNotePage({ searchParams }: { searchParams: Promise<{ order?: string; subjekt?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { order: orderId, subjekt } = await searchParams;
  const today = slovakDateKey();
  if (orderId) {
    if (typeof orderId !== "string" || orderId.length > 100) notFound();
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: {
      client: { select: { name: true } }, items: { include: { product: { select: { name: true, unit: true } } } },
      deliveryNotes: { where: { cancelledAt: null }, select: { id: true }, take: 1 },
    } });
    if (!order || !order.legalEntity) notFound();
    if (order.deliveryNotes[0]) redirect(`/financie/dodacie-listy/${order.deliveryNotes[0].id}`);
    return <>
      <PageHeader title="Dodací list z objednávky"><Link href={`/objednavky/${order.id}`} className={btnSecondary}>Späť na objednávku</Link></PageHeader>
      <DeliveryNoteForm clients={[]} products={[]} submissionKey={randomUUID()} today={today}
        deliveryDate={order.deliveredAt || order.deliveryDate ? slovakDateKey((order.deliveredAt ?? order.deliveryDate)!) : today}
        order={{ id: order.id, number: order.orderNumber, client: order.client.name, legalEntity: order.legalEntity, version: order.updatedAt.toISOString(),
          rows: order.items.map(item => ({ id: item.id, description: item.product.name, quantity: item.quantity, unit: item.product.unit })) }} />
    </>;
  }
  const { clients, catalog } = await invoiceFormOptions();
  return <>
    <PageHeader title="Dodacie listy"><Link href="/financie/dodacie-listy" className={btnSecondary}>Späť na dodacie listy</Link></PageHeader>
    <DeliveryNoteForm clients={clients} products={catalog} submissionKey={randomUUID()} today={today} deliveryDate={today}
      defaultIssuer={subjekt === "KURGI" || subjekt === "SOLE_TRADER" ? subjekt : undefined} />
  </>;
}
