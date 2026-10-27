import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { OrderForm } from "../../OrderForm";
import { updateOrder } from "../../_actions";
import { EDITABLE_ORDER_STATUSES } from "../../konstanty";

function toDateInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function UpravitObjednavkuPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ produkt?: string }> }) {
  const { id } = await params;
  const { produkt } = await searchParams;
  const [order, clients, products] = await Promise.all([
    prisma.order.findUnique({ where: { id }, include: { items: true, charges: true, invoices: { where: { direction: "VYDANA", documentStatus: { not: "CANCELLED" } }, select: { id: true } } } }),
    prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        productPrices: { select: { productId: true, unitPriceCents: true } },
        priceRules: { select: { productId: true, effectiveFrom: true, version: true, kind: true, unitPriceCents: true, discountBps: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, priceB2bCents: true, priceB2cCents: true, vatRate: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!order || !EDITABLE_ORDER_STATUSES.includes(order.status) || order.invoices.length > 0) notFound();
  const clientsForForm = clients.map((client) => ({
    ...client,
    priceRules: client.priceRules.map((rule) => ({ ...rule, effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10) })),
  }));

  const action = updateOrder.bind(null, order.id);
  return (
    <>
      <PageHeader title={`Upraviť ${order.orderNumber}`} subtitle="Úprava údajov a položiek objednávky" />
      <OrderForm
        action={action}
        clients={clientsForForm}
        products={products}
        initial={{
          clientId: order.clientId,
          legalEntity: order.legalEntity,
          channel: order.channel,
          orderDate: toDateInput(order.orderDate),
          externalId: order.externalId ?? "",
          platformPaymentStatus: order.platformPaymentStatus,
          customerPaidAt: toDateInput(order.customerPaidAt),
          platformSettledAt: toDateInput(order.platformSettledAt),
          platformSettlementCents: order.platformSettlementCents,
          platformCommissionCents: order.platformCommissionCents,
          shipmentStatus: order.shipmentStatus,
          shippedAt: toDateInput(order.shippedAt),
          deliveredAt: toDateInput(order.deliveredAt),
          deliveryDate: toDateInput(order.deliveryDate),
          latestDeliveryDate: toDateInput(order.latestDeliveryDate),
          deliveryStreet: order.deliveryStreet ?? "",
          deliveryCity: order.deliveryCity ?? "",
          deliveryZip: order.deliveryZip ?? "",
          deliveryCountry: order.deliveryCountry ?? "",
          deliveryContact: order.deliveryContact ?? "",
          paymentMethod: order.paymentMethod,
          paymentTermDays: order.paymentTermDays,
          note: order.note ?? "",
          items: order.items.map((item) => ({
            productId: item.productId, quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            unitPriceExact: item.unitPriceExact?.toString(),
            vatRate: item.vatRate, priceSource: item.priceSource,
            minimumExpiryDate: toDateInput(item.minimumExpiryDate),
          })),
          charges: order.charges,
        }}
        submitLabel="Uložiť zmeny"
        cancelHref={`/objednavky/${order.id}`}
        draftKey={`order:edit:${order.id}`}
        newProductId={products.some((product) => product.id === produkt) ? produkt : undefined}
      />
    </>
  );
}
