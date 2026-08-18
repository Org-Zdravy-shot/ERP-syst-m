import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, btnSmallDanger, card, cardHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { formatCents, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  selectActiveSupplierPrice,
  supplierInvoiceBalance,
  supplierReturnableBalance,
} from "@/lib/suppliers/domain";
import {
  supplierAccountEntryTypeLabels,
  supplierKindLabels,
  supplierLocationTypeLabels,
  supplierOrderStatusLabels,
  supplierReturnableOwnerLabels,
  supplierSourceLabels,
} from "@/lib/zod-schemas";
import {
  deactivateSupplierBankAccount,
  deleteSupplierContact,
  deleteSupplierLocation,
  toggleSupplierActive,
} from "../_actions";
import {
  SupplierBankAccountForm,
  SupplierContactForm,
  SupplierLocationForm,
} from "../SupplierProfileForms";
import {
  SupplierAccountEntryForm,
  SupplierCatalogItemForm,
  SupplierInvoiceLinkForm,
  SupplierPriceForm,
  SupplierReturnableMovementForm,
  SupplierReturnableTypeForm,
} from "../SupplierCommercialForms";
import {
  toggleSupplierCatalogItem,
  unlinkSupplierInvoice,
} from "../_commercial-actions";

function mapHref(location: { street: string | null; city: string | null; zip: string | null; country: string }) {
  const query = [location.street, location.zip, location.city, location.country].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function oldestOutstandingDueDate(
  movements: Array<{ quantity: number; occurredAt: Date; dueDate: Date | null }>,
): Date | null {
  const lots: Array<{ quantity: number; dueDate: Date | null }> = [];
  for (const movement of [...movements].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())) {
    if (movement.quantity > 0) {
      lots.push({ quantity: movement.quantity, dueDate: movement.dueDate });
      continue;
    }
    let returned = Math.abs(movement.quantity);
    for (const lot of lots) {
      if (returned <= 0) break;
      const consumed = Math.min(lot.quantity, returned);
      lot.quantity -= consumed;
      returned -= consumed;
    }
  }
  return lots
    .filter((lot) => lot.quantity > 1e-9 && lot.dueDate)
    .map((lot) => lot.dueDate as Date)
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-50 py-2 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-stone-900">{children || "—"}</dd>
    </div>
  );
}

export default async function DodavatelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canViewFinance = hasFinancePermission(session.role, "VIEW");
  const canConfigureFinance = hasFinancePermission(session.role, "CONFIGURE");
  const canCreateOrder = hasFinancePermission(session.role, "CREATE_DRAFT");
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      locations: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      bankAccounts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      tags: { orderBy: { name: "asc" } },
      catalogItems: {
        include: {
          material: { select: { id: true, name: true, unit: true } },
          product: { select: { id: true, name: true, unit: true } },
          prices: { orderBy: [{ minimumQuantity: "asc" }, { validFrom: "desc" }] },
        },
        orderBy: [{ isActive: "desc" }, { isPreferred: "desc" }, { name: "asc" }],
      },
      orders: {
        select: { id: true, orderNumber: true, status: true, orderDate: true, requestedDeliveryDate: true },
        orderBy: { orderDate: "desc" },
        take: 8,
      },
      returnableTypes: {
        include: { movements: { orderBy: { occurredAt: "desc" } } },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      },
    },
  });
  if (!supplier) notFound();

  const [invoices, unlinkedInvoices, accountEntries, audit, materials, products] = await Promise.all([
    canViewFinance
      ? prisma.invoice.findMany({
          where: { supplierId: supplier.id, direction: "PRIJATA" },
          include: { paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } } },
          orderBy: { issueDate: "desc" },
        })
      : Promise.resolve([]),
    canConfigureFinance
      ? prisma.invoice.findMany({
          where: { supplierId: null, direction: "PRIJATA" },
          select: {
            id: true,
            invoiceNumber: true,
            externalNumber: true,
            supplierName: true,
            issueDate: true,
            totalGrossCents: true,
          },
          orderBy: { issueDate: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    canViewFinance
      ? prisma.supplierAccountEntry.findMany({
          where: { supplierId: supplier.id },
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "Supplier", entityId: supplier.id },
          { metadata: { path: ["supplierId"], equals: supplier.id } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.material.findMany({
      where: { isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const openOrders = supplier.orders.filter((order) => !["RECEIVED", "CANCELLED"].includes(order.status));
  const totalPurchasedCents = invoices
    .filter((invoice) => invoice.documentStatus === "ISSUED")
    .reduce(
      (sum, invoice) => sum + invoice.totalGrossCents * (invoice.documentType === "CREDIT_NOTE" ? -1 : 1),
      0,
    );
  const invoiceBalance = supplierInvoiceBalance(
    invoices.map((invoice) => ({
      documentType: invoice.documentType as "INVOICE" | "CREDIT_NOTE",
      documentStatus: invoice.documentStatus as "DRAFT" | "ISSUED" | "CANCELLED",
      totalGrossCents: invoice.totalGrossCents,
      allocatedCents: invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0),
    })),
  );
  const manualBalance = accountEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
  const totalBalance = invoiceBalance + manualBalance;
  const returnableBalanceCount = supplier.returnableTypes.filter((type) => {
    return supplierReturnableBalance(type.movements.map((movement) => movement.quantity)) > 0;
  }).length;
  const toggleAction = toggleSupplierActive.bind(null, supplier.id);

  return (
    <>
      <PageHeader
        title={supplier.name}
        subtitle={`${supplierKindLabels[supplier.kind] ?? supplier.kind} · ${supplier.isActive ? "aktívny dodávateľ" : "neaktívny"}`}
      >
        {canCreateOrder && <Link href={`/dodavatelia/objednavky/nova?dodavatel=${supplier.id}`} className={btnSecondary}>+ Nákupná objednávka</Link>}
        <Link href={`/dodavatelia/${supplier.id}/upravit`} className={btnSecondary}>Upraviť</Link>
        <form action={toggleAction}>
          <button className={btnSecondary}>{supplier.isActive ? "Deaktivovať" : "Aktivovať"}</button>
        </form>
      </PageHeader>

      <div className="mb-6 flex flex-wrap gap-2">
        {supplier.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}
        {supplier.rating && <Badge color="amber">{"★".repeat(supplier.rating)}{"☆".repeat(5 - supplier.rating)}</Badge>}
      </div>

      <div className={`mb-6 grid grid-cols-2 gap-3 ${canViewFinance ? "xl:grid-cols-6" : "xl:grid-cols-4"}`}>
        <div className={`${card} p-4`}>
          <div className="text-xs uppercase tracking-wide text-stone-400">Kontakty a miesta</div>
          <div className="mt-1 text-2xl font-bold">{supplier.contacts.length + supplier.locations.length}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs uppercase tracking-wide text-stone-400">Aktívne ponuky</div>
          <div className="mt-1 text-2xl font-bold">{supplier.catalogItems.filter((item) => item.isActive).length}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs uppercase tracking-wide text-stone-400">Otvorené objednávky</div>
          <div className="mt-1 text-2xl font-bold">{openOrders.length}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs uppercase tracking-wide text-stone-400">Nevyrovnané obaly</div>
          <div className="mt-1 text-2xl font-bold">{returnableBalanceCount}</div>
        </div>
        {canViewFinance && <div className={`${card} p-4`}>
          <div className="text-xs uppercase tracking-wide text-stone-400">Nakúpené spolu</div>
          <div className="mt-1 text-xl font-bold">{formatCents(totalPurchasedCents)}</div>
        </div>}
        {canViewFinance && <div className={`${card} p-4`}>
          <div className="text-xs uppercase tracking-wide text-stone-400">Vzájomný zostatok</div>
          <div className={`mt-1 text-xl font-bold ${totalBalance > 0 ? "text-red-700" : totalBalance < 0 ? "text-emerald-700" : ""}`}>
            {formatCents(Math.abs(totalBalance))}
          </div>
          <div className="mt-0.5 text-xs text-stone-400">
            {totalBalance > 0 ? "dlžíme dodávateľovi" : totalBalance < 0 ? "dodávateľ dlží nám" : "vyrovnané"}
          </div>
        </div>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <section className={card}>
            <h2 className={cardHeader}>Profil</h2>
            <dl className="px-5 py-2">
              <InfoRow label="Právny názov">{supplier.legalName ?? supplier.name}</InfoRow>
              <InfoRow label="IČO">{supplier.ico}</InfoRow>
              <InfoRow label="DIČ">{supplier.dic}</InfoRow>
              <InfoRow label="IČ DPH">{supplier.icDph}</InfoRow>
              <InfoRow label="E-mail">{supplier.email && <a href={`mailto:${supplier.email}`} className="hover:underline">{supplier.email}</a>}</InfoRow>
              <InfoRow label="Telefón">{supplier.phone && <a href={`tel:${supplier.phone}`} className="hover:underline">{supplier.phone}</a>}</InfoRow>
              <InfoRow label="Web">{supplier.website && <a href={supplier.website} target="_blank" rel="noreferrer" className="hover:underline">Otvoriť web ↗</a>}</InfoRow>
              <InfoRow label="Splatnosť">{supplier.paymentTermsDays} dní</InfoRow>
              <InfoRow label="Zdroj">{supplierSourceLabels[supplier.source] ?? supplier.source}</InfoRow>
              <InfoRow label="Detail zdroja">{supplier.sourceDetail}</InfoRow>
            </dl>
            {supplier.note && <p className="border-t border-stone-100 px-5 py-4 whitespace-pre-wrap text-sm text-stone-600">{supplier.note}</p>}
          </section>

          <section className={card}>
            <h2 className={cardHeader}>Kontaktné osoby ({supplier.contacts.length})</h2>
            <div className="divide-y divide-stone-100">
              {supplier.contacts.map((contact) => {
                const removeAction = deleteSupplierContact.bind(null, supplier.id, contact.id);
                return <div key={contact.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-stone-900">{contact.name} {contact.isPrimary && <Badge color="emerald">hlavný</Badge>}</div>
                      {contact.role && <div className="text-xs text-stone-400">{contact.role}</div>}
                      <div className="mt-1 text-sm text-stone-600">
                        {contact.email && <a href={`mailto:${contact.email}`} className="mr-3 hover:underline">{contact.email}</a>}
                        {contact.phone && <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a>}
                      </div>
                      {contact.note && <p className="mt-1 text-xs text-stone-500">{contact.note}</p>}
                    </div>
                    <form action={removeAction}><button className={btnSmallDanger}>Odstrániť</button></form>
                  </div>
                </div>;
              })}
              {supplier.contacts.length === 0 && <p className="px-5 py-6 text-sm text-stone-400">Zatiaľ bez kontaktnej osoby.</p>}
            </div>
            <SupplierContactForm supplierId={supplier.id} />
          </section>
        </div>

        <div className="space-y-6 xl:col-span-2">
          <section className={card}>
            <h2 className={cardHeader}>Miesta a prevádzky ({supplier.locations.length})</h2>
            <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
              {supplier.locations.map((location) => {
                const removeAction = deleteSupplierLocation.bind(null, supplier.id, location.id);
                const maps = mapHref(location);
                return <div key={location.id} className="rounded-[10px] border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-stone-900">{location.name} {location.isPrimary && <Badge color="emerald">hlavné</Badge>}</div>
                      <div className="text-xs text-stone-400">{supplierLocationTypeLabels[location.type] ?? location.type}</div>
                    </div>
                    <form action={removeAction}><button className={btnSmallDanger}>Odstrániť</button></form>
                  </div>
                  <p className="mt-2 text-sm text-stone-600">
                    {[location.street, [location.zip, location.city].filter(Boolean).join(" "), location.country].filter(Boolean).join(", ") || "Adresa nie je vyplnená"}
                  </p>
                  {location.openingHours && <p className="mt-1 text-xs text-stone-500">{location.openingHours}</p>}
                  {location.deliveryInstructions && <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs text-stone-600">{location.deliveryInstructions}</p>}
                  {maps && <a href={maps} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-stone-700 hover:underline">Otvoriť v mape ↗</a>}
                </div>;
              })}
              {supplier.locations.length === 0 && <p className="text-sm text-stone-400">Zatiaľ bez adresy alebo miesta odberu.</p>}
            </div>
            <SupplierLocationForm supplierId={supplier.id} />
          </section>

          <section className={card}>
            <h2 className={cardHeader}>Ponuky, balenia a ceny ({supplier.catalogItems.length})</h2>
            <div className="divide-y divide-stone-100">
              {supplier.catalogItems.map((item) => {
                const currentPrice = selectActiveSupplierPrice(
                  item.prices,
                  Math.max(item.minOrderQuantity, item.packQuantity),
                  new Date(),
                );
                const toggleCatalogAction = toggleSupplierCatalogItem.bind(null, supplier.id, item.id);
                const stockLink = item.material
                  ? `Surovina: ${item.material.name}`
                  : item.product
                    ? `Produkt: ${item.product.name}`
                    : "Služba / bez skladovej väzby";
                return <div key={item.id} className={`px-5 py-4 ${item.isActive ? "" : "bg-stone-50 opacity-70"}`}>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-stone-900">{item.name}</span>
                        {item.isPreferred && <Badge color="emerald">preferovaná</Badge>}
                        {!item.isActive && <Badge>neaktívna</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-stone-400">
                        {stockLink}{item.supplierSku ? ` · SKU ${item.supplierSku}` : ""}
                      </div>
                      <div className="mt-2 text-sm text-stone-600">
                        balenie {formatQty(item.packQuantity, item.unit)} · minimum {formatQty(item.minOrderQuantity, item.unit)} · krok {formatQty(item.orderMultiple, item.unit)} · dodanie {item.leadTimeDays} dní
                      </div>
                      {(item.originCountry || item.qualityNote) && <div className="mt-1 text-xs text-stone-500">
                        {item.originCountry ? `Pôvod ${item.originCountry}` : ""}{item.originCountry && item.qualityNote ? " · " : ""}{item.qualityNote}
                      </div>}
                    </div>
                    <div className="flex shrink-0 items-start gap-2">
                      {canViewFinance && <div className="text-right">
                        <div className="font-semibold text-stone-900">
                          {currentPrice ? `${formatCents(currentPrice.unitPriceCents)} / ${formatQty(currentPrice.pricePerQuantity, item.unit)}` : "Cena chýba"}
                        </div>
                        {currentPrice && <div className="text-xs text-stone-400">
                          {currentPrice.priceType === "NET" ? "bez DPH" : "s DPH"}{currentPrice.vatRate !== null ? ` · DPH ${currentPrice.vatRate} %` : ""}
                        </div>}
                      </div>}
                      {canConfigureFinance && <form action={toggleCatalogAction}>
                        <button className={btnSmallDanger}>{item.isActive ? "Deaktivovať" : "Aktivovať"}</button>
                      </form>}
                    </div>
                  </div>

                  {canViewFinance && item.prices.length > 0 && <details className="mt-3 rounded-[10px] border border-stone-100 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-stone-600">História a množstevné ceny ({item.prices.length})</summary>
                    <div className="mt-2 divide-y divide-stone-100">
                      {item.prices.map((price) => <div key={price.id} className="grid grid-cols-1 gap-1 py-2 text-xs text-stone-600 sm:grid-cols-3">
                        <div className="font-medium text-stone-800">{formatCents(price.unitPriceCents)} / {formatQty(price.pricePerQuantity, item.unit)}</div>
                        <div>od {formatQty(price.minimumQuantity, item.unit)} · {price.priceType === "NET" ? "bez DPH" : "s DPH"}{price.vatRate !== null ? ` · ${price.vatRate} %` : ""}</div>
                        <div className="sm:text-right">{formatDate(price.validFrom)} – {price.validTo ? formatDate(price.validTo) : "bez konca"}</div>
                      </div>)}
                    </div>
                  </details>}
                  {canConfigureFinance && item.isActive && <SupplierPriceForm supplierId={supplier.id} catalogItemId={item.id} />}
                </div>;
              })}
              {supplier.catalogItems.length === 0 && <p className="px-5 py-6 text-sm text-stone-400">Zatiaľ bez ponuky. Ponuku možno naviazať na surovinu, produkt alebo evidovať ako službu.</p>}
            </div>
            {canConfigureFinance && <SupplierCatalogItemForm supplierId={supplier.id} materials={materials} products={products} />}
          </section>

          <section className={card}>
            <h2 className={cardHeader}>Vratné obaly a nádoby ({supplier.returnableTypes.length})</h2>
            <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
              {supplier.returnableTypes.map((type) => {
                const balance = supplierReturnableBalance(type.movements.map((movement) => movement.quantity));
                const oldestDueDate = oldestOutstandingDueDate(type.movements);
                const overdue = oldestDueDate !== null && oldestDueDate.getTime() < Date.now();
                const balanceMeaning = type.owner === "SUPPLIER" ? "držíme my" : "drží dodávateľ";
                return <div key={type.id} className="rounded-[10px] border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-stone-900">{type.name}</div>
                      <div className="text-xs text-stone-400">{supplierReturnableOwnerLabels[type.owner] ?? type.owner}</div>
                    </div>
                    <Badge color={balance > 0 ? (overdue ? "red" : "amber") : "emerald"}>
                      {balance > 0 ? `${formatQty(balance, type.unit)} ${balanceMeaning}` : "vyrovnané"}
                    </Badge>
                  </div>
                  {(canViewFinance || type.expectedReturnDays) && <div className="mt-2 text-xs text-stone-500">
                    {canViewFinance && (type.depositCents !== null ? `Depozit ${formatCents(type.depositCents)} / ${type.unit}` : "Bez evidovaného depozitu")}
                    {type.expectedReturnDays ? `${canViewFinance ? " · " : ""}bežne ${type.expectedReturnDays} dní` : ""}
                  </div>}
                  {oldestDueDate && balance > 0 && <div className={`mt-2 text-xs font-semibold ${overdue ? "text-red-700" : "text-amber-700"}`}>
                    {overdue ? "Po termíne od" : "Najbližší termín"} {formatDate(oldestDueDate)}
                  </div>}
                  {type.reminderNote && <p className="mt-2 text-xs text-stone-500">{type.reminderNote}</p>}
                  {type.movements.length > 0 && <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-stone-600">História pohybov ({type.movements.length})</summary>
                    <div className="mt-2 divide-y divide-stone-100">
                      {type.movements.slice(0, 20).map((movement) => <div key={movement.id} className="flex justify-between gap-3 py-2 text-xs">
                        <div>
                          <span className={movement.quantity > 0 ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
                            {movement.quantity > 0 ? "+" : ""}{formatQty(movement.quantity, type.unit)}
                          </span>
                          {movement.reference ? ` · ${movement.reference}` : ""}
                          {movement.note && <div className="text-stone-400">{movement.note}</div>}
                        </div>
                        <div className="shrink-0 text-right text-stone-400">{formatDate(movement.occurredAt)}{movement.dueDate ? <div>termín {formatDate(movement.dueDate)}</div> : null}</div>
                      </div>)}
                    </div>
                  </details>}
                  {type.isActive && <SupplierReturnableMovementForm supplierId={supplier.id} typeId={type.id} owner={type.owner} unit={type.unit} />}
                </div>;
              })}
              {supplier.returnableTypes.length === 0 && <p className="text-sm text-stone-400">Zatiaľ bez vratných obalov. Evidovať možno nádoby na med, palety aj zálohované prepravky.</p>}
            </div>
            <SupplierReturnableTypeForm supplierId={supplier.id} canSetDeposit={canConfigureFinance} />
          </section>

          {canViewFinance && <section className={card}>
            <h2 className={cardHeader}>Bankové účty</h2>
            <div className="divide-y divide-stone-100">
              {supplier.bankAccounts.filter((account) => account.isActive).map((account) => {
                const deactivateAction = deactivateSupplierBankAccount.bind(null, supplier.id, account.id);
                return <div key={account.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <div className="font-mono text-sm font-medium text-stone-900">{account.iban}</div>
                    <div className="text-xs text-stone-400">{account.name ?? "Účet"} · {account.currency} {account.isPrimary && "· hlavný"}</div>
                  </div>
                  {canConfigureFinance && <form action={deactivateAction}><button className={btnSmallDanger}>Deaktivovať</button></form>}
                </div>;
              })}
              {supplier.bankAccounts.filter((account) => account.isActive).length === 0 && <p className="px-5 py-6 text-sm text-stone-400">Žiadny aktívny bankový účet.</p>}
            </div>
            {canConfigureFinance && <SupplierBankAccountForm supplierId={supplier.id} />}
          </section>}

          {canViewFinance && <section className={card}>
            <h2 className={cardHeader}>Faktúry a vzájomný zostatok</h2>
            <div className="grid grid-cols-1 gap-3 border-b border-stone-100 p-5 sm:grid-cols-3">
              <div className="rounded-[10px] bg-stone-50 p-3">
                <div className="text-xs text-stone-400">Z prijatých faktúr</div>
                <div className={`mt-1 font-bold ${invoiceBalance > 0 ? "text-red-700" : invoiceBalance < 0 ? "text-emerald-700" : ""}`}>{formatCents(Math.abs(invoiceBalance))}</div>
              </div>
              <div className="rounded-[10px] bg-stone-50 p-3">
                <div className="text-xs text-stone-400">Iné dohody a depozity</div>
                <div className={`mt-1 font-bold ${manualBalance > 0 ? "text-red-700" : manualBalance < 0 ? "text-emerald-700" : ""}`}>{formatCents(Math.abs(manualBalance))}</div>
              </div>
              <div className="rounded-[10px] bg-stone-900 p-3 text-white">
                <div className="text-xs text-stone-300">Výsledný zostatok</div>
                <div className="mt-1 font-bold">{formatCents(Math.abs(totalBalance))}</div>
                <div className="text-xs text-stone-300">{totalBalance > 0 ? "dlžíme dodávateľovi" : totalBalance < 0 ? "dodávateľ dlží nám" : "vyrovnané"}</div>
              </div>
            </div>

            <div className="divide-y divide-stone-100">
              {invoices.map((invoice) => {
                const allocatedCents = invoice.paymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
                const outstandingCents = supplierInvoiceBalance([{
                  documentType: invoice.documentType as "INVOICE" | "CREDIT_NOTE",
                  documentStatus: invoice.documentStatus as "DRAFT" | "ISSUED" | "CANCELLED",
                  totalGrossCents: invoice.totalGrossCents,
                  allocatedCents,
                }]);
                const unlinkAction = unlinkSupplierInvoice.bind(null, supplier.id, invoice.id);
                return <div key={invoice.id} className="flex flex-col justify-between gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center">
                  <div>
                    <div className="font-medium text-stone-900">
                      {invoice.documentType === "CREDIT_NOTE" ? "Dobropis" : "Prijatá faktúra"} {invoice.invoiceNumber ?? invoice.externalNumber ?? "bez čísla"}
                    </div>
                    <div className="text-xs text-stone-400">{formatDate(invoice.issueDate)} · splatnosť {formatDate(invoice.dueDate)} · suma {formatCents(invoice.totalGrossCents)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right">
                      <div className={`font-semibold ${outstandingCents > 0 ? "text-red-700" : outstandingCents < 0 ? "text-emerald-700" : "text-stone-500"}`}>{outstandingCents === 0 ? "uhradené" : formatCents(Math.abs(outstandingCents))}</div>
                      {allocatedCents > 0 && <div className="text-xs text-stone-400">alokované {formatCents(allocatedCents)}</div>}
                    </div>
                    {canConfigureFinance && <form action={unlinkAction}><button className={btnSmallDanger}>Odpojiť</button></form>}
                  </div>
                </div>;
              })}
              {invoices.length === 0 && <p className="px-5 py-6 text-sm text-stone-400">K dodávateľovi zatiaľ nie je priradená prijatá faktúra.</p>}
            </div>
            {canConfigureFinance && <SupplierInvoiceLinkForm
              supplierId={supplier.id}
              invoices={unlinkedInvoices.map((invoice) => ({
                id: invoice.id,
                label: `${invoice.externalNumber ?? invoice.invoiceNumber ?? "Bez čísla"} · ${invoice.supplierName ?? "bez dodávateľa"} · ${formatDate(invoice.issueDate)} · ${formatCents(invoice.totalGrossCents)}`,
              }))}
            />}

            <div className="border-t border-stone-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-stone-400">Ostatné finančné pohyby</div>
            <div className="divide-y divide-stone-100">
              {accountEntries.map((entry) => <div key={entry.id} className="flex justify-between gap-4 px-5 py-3 text-sm">
                <div>
                  <div className="font-medium text-stone-800">{supplierAccountEntryTypeLabels[entry.type] ?? entry.type}{entry.reference ? ` · ${entry.reference}` : ""}</div>
                  <div className="text-xs text-stone-400">{formatDate(entry.occurredAt)}{entry.dueDate ? ` · splatnosť ${formatDate(entry.dueDate)}` : ""}</div>
                  {entry.note && <div className="mt-1 text-xs text-stone-500">{entry.note}</div>}
                </div>
                <div className={`shrink-0 text-right font-semibold ${entry.amountCents > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {entry.amountCents > 0 ? "+" : "−"}{formatCents(Math.abs(entry.amountCents))}
                  <div className="text-xs font-normal text-stone-400">{entry.amountCents > 0 ? "dlžíme my" : "dlží dodávateľ"}</div>
                </div>
              </div>)}
              {accountEntries.length === 0 && <p className="px-5 py-4 text-sm text-stone-400">Bez iných záväzkov, kreditov alebo depozitov.</p>}
            </div>
            {canConfigureFinance && <SupplierAccountEntryForm supplierId={supplier.id} />}
          </section>}

          <section className={card}>
            <h2 className={cardHeader}>Posledné nákupné objednávky</h2>
            <div className="divide-y divide-stone-100">
              {supplier.orders.map((order) => <div key={order.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div>
                  <Link href={`/dodavatelia/objednavky/${order.id}`} className="font-medium text-stone-900 hover:underline">{order.orderNumber}</Link>
                  <div className="text-xs text-stone-400">{formatDate(order.orderDate)}{order.requestedDeliveryDate ? ` · termín ${formatDate(order.requestedDeliveryDate)}` : ""}</div>
                </div>
                <Badge color={order.status === "RECEIVED" ? "emerald" : order.status === "CANCELLED" ? "red" : "amber"}>
                  {supplierOrderStatusLabels[order.status] ?? order.status}
                </Badge>
              </div>)}
              {supplier.orders.length === 0 && <p className="px-5 py-6 text-sm text-stone-400">Zatiaľ bez nákupnej objednávky.</p>}
            </div>
          </section>

          <section className={card}>
            <h2 className={cardHeader}>Aktivita profilu</h2>
            <div className="divide-y divide-stone-100">
              {audit.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="font-medium text-stone-700">{entry.action}</div>
                <div className="text-xs text-stone-400">{entry.actorEmail ?? "systém"} · {formatDateTime(entry.createdAt)}</div>
              </div>)}
              {audit.length === 0 && <p className="px-5 py-6 text-sm text-stone-400">Zatiaľ bez zaznamenanej aktivity.</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
