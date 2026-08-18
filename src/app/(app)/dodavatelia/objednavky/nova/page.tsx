import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { createSupplierOrder } from "../../_order-actions";
import { SupplierOrderForm } from "../../SupplierOrderForm";

export default async function NovaNakupnaObjednavkaPage({
  searchParams,
}: {
  searchParams: Promise<{ dodavatel?: string }>;
}) {
  const { dodavatel } = await searchParams;
  const session = await getSession();
  if (!hasFinancePermission(session.role, "CREATE_DRAFT")) redirect("/dodavatelia/objednavky");
  const suppliers = await prisma.supplier.findMany({
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
  });
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
      <PageHeader title="Nová nákupná objednávka" subtitle="Najprv vznikne koncept; bez vášho potvrdenia sa nič neodošle">
        <Link href="/dodavatelia/objednavky" className={btnSecondary}>← Späť</Link>
      </PageHeader>
      {suppliers.length ? (
        <SupplierOrderForm
          action={createSupplierOrder}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
          offers={offers}
          initial={dodavatel && suppliers.some((supplier) => supplier.id === dodavatel) ? { supplierId: dodavatel, items: [] } : undefined}
        />
      ) : (
        <div className="rounded-[14px] border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
          Najprv vytvorte aktívneho dodávateľa a pridajte mu ponuku s cenou.
          <div><Link href="/dodavatelia/novy" className="mt-3 inline-block font-semibold text-stone-900 hover:underline">Vytvoriť dodávateľa</Link></div>
        </div>
      )}
    </>
  );
}
