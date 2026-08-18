import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, btnSmallDanger, card, cardHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { supplierInvoiceBalance } from "@/lib/suppliers/domain";
import {
  supplierKindLabels,
  supplierLocationTypeLabels,
  supplierOrderStatusLabels,
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

function mapHref(location: { street: string | null; city: string | null; zip: string | null; country: string }) {
  const query = [location.street, location.zip, location.city, location.country].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
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
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      locations: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      bankAccounts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      tags: { orderBy: { name: "asc" } },
      catalogItems: { select: { id: true, isActive: true } },
      orders: {
        select: { id: true, orderNumber: true, status: true, orderDate: true, requestedDeliveryDate: true },
        orderBy: { orderDate: "desc" },
        take: 8,
      },
      returnableTypes: { select: { id: true } },
    },
  });
  if (!supplier) notFound();

  const [invoices, accountEntries, audit] = await Promise.all([
    canViewFinance
      ? prisma.invoice.findMany({
          where: { supplierId: supplier.id, direction: "PRIJATA" },
          include: { paymentAllocations: { where: { reversedAt: null }, select: { amountCents: true } } },
          orderBy: { issueDate: "desc" },
        })
      : Promise.resolve([]),
    canViewFinance
      ? prisma.supplierAccountEntry.findMany({ where: { supplierId: supplier.id }, select: { amountCents: true } })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: { entityType: "Supplier", entityId: supplier.id },
      orderBy: { createdAt: "desc" },
      take: 8,
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
  const toggleAction = toggleSupplierActive.bind(null, supplier.id);

  return (
    <>
      <PageHeader
        title={supplier.name}
        subtitle={`${supplierKindLabels[supplier.kind] ?? supplier.kind} · ${supplier.isActive ? "aktívny dodávateľ" : "neaktívny"}`}
      >
        <Link href={`/dodavatelia/${supplier.id}/upravit`} className={btnSecondary}>Upraviť</Link>
        <form action={toggleAction}>
          <button className={btnSecondary}>{supplier.isActive ? "Deaktivovať" : "Aktivovať"}</button>
        </form>
      </PageHeader>

      <div className="mb-6 flex flex-wrap gap-2">
        {supplier.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}
        {supplier.rating && <Badge color="amber">{"★".repeat(supplier.rating)}{"☆".repeat(5 - supplier.rating)}</Badge>}
      </div>

      <div className={`mb-6 grid grid-cols-2 gap-3 ${canViewFinance ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}>
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

          <section className={card}>
            <h2 className={cardHeader}>Posledné nákupné objednávky</h2>
            <div className="divide-y divide-stone-100">
              {supplier.orders.map((order) => <div key={order.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div>
                  <div className="font-medium text-stone-900">{order.orderNumber}</div>
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
