import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { OrderForm } from "../../OrderForm";
import { updateOrder } from "../../_actions";
import { EDITABLE_ORDER_STATUSES } from "../../konstanty";

function toDateInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function UpravitObjednavkuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, clients, products] = await Promise.all([
    prisma.order.findUnique({ where: { id }, include: { items: true } }),
    prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        productPrices: { select: { productId: true, unitPriceCents: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, priceB2bCents: true, priceB2cCents: true, vatRate: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!order || !EDITABLE_ORDER_STATUSES.includes(order.status)) notFound();

  const action = updateOrder.bind(null, order.id);
  return (
    <>
      <PageHeader title={`Upraviť ${order.orderNumber}`} subtitle="Úprava údajov a položiek objednávky" />
      <OrderForm
        action={action}
        clients={clients}
        products={products}
        initial={{
          clientId: order.clientId,
          channel: order.channel,
          deliveryDate: toDateInput(order.deliveryDate),
          note: order.note ?? "",
          items: order.items,
        }}
        submitLabel="Uložiť zmeny"
        cancelHref={`/objednavky/${order.id}`}
      />
    </>
  );
}
