import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { updateSupplierOrder } from "../../../_order-actions";
import { SupplierOrderForm } from "../../../SupplierOrderForm";

function euroInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export default async function UpravitNakupnuObjednavkuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!hasFinancePermission(session.role, "CREATE_DRAFT")) redirect(`/dodavatelia/objednavky/${id}`);
  const [order, suppliers] = await Promise.all([
    prisma.supplierOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNumber: "asc" } } } }),
    prisma.supplier.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        catalogItems: {
          where: { isActive: true },
          include: { prices: { orderBy: [{ minimumQuantity: "desc" }, { validFrom: "desc" }] } },
          orderBy: [{ isPreferred: "desc" }, { name: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!order) notFound();
  if (order.status !== "DRAFT") redirect(`/dodavatelia/objednavky/${id}`);
  const offers = suppliers.flatMap((supplier) => supplier.catalogItems.map((offer) => ({
    id: offer.id,
    supplierId: supplier.id,
    name: offer.name,
    supplierSku: offer.supplierSku,
    unit: offer.unit,
    packQuantity: offer.packQuantity,
    minOrderQuantity: offer.minOrderQuantity,
    orderMultiple: offer.orderMultiple,
    leadTimeDays: offer.leadTimeDays,
    prices: offer.prices.map((price) => ({
      unitPriceCents: price.unitPriceCents,
      pricePerQuantity: price.pricePerQuantity,
      minimumQuantity: price.minimumQuantity,
      priceType: price.priceType,
      vatRate: price.vatRate,
      validFrom: price.validFrom.toISOString(),
      validTo: price.validTo?.toISOString() ?? null,
    })),
  })));

  return (
    <>
      <PageHeader title={`Upraviť ${order.orderNumber}`} subtitle="Upravovať možno iba koncept; ceny sa pri uložení znova overia na serveri">
        <Link href={`/dodavatelia/objednavky/${order.id}`} className={btnSecondary}>← Späť</Link>
      </PageHeader>
      <SupplierOrderForm
        action={updateSupplierOrder.bind(null, order.id)}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        offers={offers}
        initial={{
          supplierId: order.supplierId,
          requestedDeliveryDate: order.requestedDeliveryDate?.toISOString().slice(0, 10),
          shipping: euroInput(order.shippingCents),
          discount: euroInput(order.discountCents),
          note: order.note ?? undefined,
          items: order.items.map((item) => ({ catalogItemId: item.catalogItemId ?? "", quantity: item.quantity })).filter((item) => item.catalogItemId),
        }}
      />
    </>
  );
}
