import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { slovakDateKey } from "../../../objednavky/pricing";
import { invoiceFormOptions } from "../../faktury/form-options";
import { CommercialDocumentForm } from "../../CommercialDocumentForm";
import { canCreateDeliveryFromInvoice } from "@/lib/finance/delivery/service";
import { deliveryLinesSchema } from "@/lib/finance/delivery/schema";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";

export default async function NewDeliveryNotePage({ searchParams }: { searchParams: Promise<{ order?: string; invoice?: string; quote?: string; subjekt?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { order: orderId, invoice: invoiceId, quote: quoteId, subjekt } = await searchParams;
  const today = slovakDateKey();
  if ([orderId, invoiceId, quoteId].filter(Boolean).length > 1) notFound();
  if (invoiceId) {
    if (typeof invoiceId !== "string" || invoiceId.length > 100) notFound();
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: {
      items: { orderBy: { lineNumber: "asc" } }, deliveryNoteLinks: { take: 1, select: { deliveryNoteId: true } },
    } });
    if (!invoice || !invoice.legalEntity || !canCreateDeliveryFromInvoice(invoice)) notFound();
    if (invoice.deliveryNoteLinks[0]) redirect(`/financie/dodacie-listy/${invoice.deliveryNoteLinks[0].deliveryNoteId}`);
    const customer = financePartySnapshotSchema.parse(invoice.counterpartySnapshot);
    return <>
      <PageHeader title="Dodací list z faktúry"><Link href={`/financie/faktury/${invoice.id}`} className={btnSecondary}>Späť na faktúru</Link></PageHeader>
      <CommercialDocumentForm clients={[]} products={[]} submissionKey={randomUUID()} today={today}
        deliveryDate={(invoice.deliveryDate ?? invoice.issueDate).toISOString().slice(0, 10)}
        source={{ kind: "invoice", id: invoice.id, number: invoice.invoiceNumber ?? "", client: customer.name,
          legalEntity: invoice.legalEntity, version: invoice.updatedAt.toISOString(),
          rows: invoice.items.map(item => ({ id: item.id, description: item.description, quantity: item.quantity, unit: item.unit })) }} />
    </>;
  }
  if (quoteId) {
    if (typeof quoteId !== "string" || quoteId.length > 100) notFound();
    const quote = await prisma.salesQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.status !== "ACCEPTED") notFound();
    const customer = financePartySnapshotSchema.parse(quote.counterpartySnapshot);
    return <>
      <PageHeader title="Dodací list z ponuky"><Link href={`/financie/cenove-ponuky/${quote.id}`} className={btnSecondary}>Späť na ponuku</Link></PageHeader>
      <CommercialDocumentForm clients={[]} products={[]} submissionKey={randomUUID()} today={today} deliveryDate={today}
        source={{ kind: "quote", id: quote.id, number: quote.number, client: customer.name,
          legalEntity: quote.legalEntity, version: quote.updatedAt.toISOString(),
          rows: deliveryLinesSchema.parse(quote.lines).map((item, index) => ({ id: String(index), description: item.description, quantity: item.quantity, unit: item.unit })) }} />
    </>;
  }
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
      <CommercialDocumentForm clients={[]} products={[]} submissionKey={randomUUID()} today={today}
        deliveryDate={order.deliveredAt || order.deliveryDate ? slovakDateKey((order.deliveredAt ?? order.deliveryDate)!) : today}
        source={{ kind: "order", id: order.id, number: order.orderNumber, client: order.client.name, legalEntity: order.legalEntity, version: order.updatedAt.toISOString(),
          rows: order.items.map(item => ({ id: item.id, description: item.product.name, quantity: item.quantity, unit: item.product.unit })) }} />
    </>;
  }
  const { clients, catalog } = await invoiceFormOptions();
  return <>
    <PageHeader title="Dodacie listy"><Link href="/financie/dodacie-listy" className={btnSecondary}>Späť na dodacie listy</Link></PageHeader>
    <CommercialDocumentForm clients={clients} products={catalog} submissionKey={randomUUID()} today={today} deliveryDate={today}
      defaultIssuer={subjekt === "KURGI" || subjekt === "SOLE_TRADER" ? subjekt : undefined} />
  </>;
}
