import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasFinancePermission, requireFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { InvoiceForm } from "../../nova/InvoiceForm";
import { canEditManualDraft, invoiceFormInitial } from "../../invoice-form-data";
import { updateManualInvoice } from "../../../_actions";
import { invoiceFormOptions } from "../../form-options";

export default async function UpravitFakturuPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireFinancePermission("CREATE_DRAFT");
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: { orderBy: { lineNumber: "asc" } }, deliveryNoteLinks: { select: { deliveryNoteId: true }, take: 1 } } });
  if (!invoice || !canEditManualDraft(invoice)) notFound();
  const { clients, issuers, catalog } = await invoiceFormOptions();
  const initial = invoiceFormInitial(invoice, "edit");
  return <>
    <PageHeader title="Upraviť koncept faktúry" subtitle="Zmeny sa uložia bez vystavenia alebo odoslania dokladu">
      <Link href={`/financie/faktury/${id}`} className={btnSecondary}>← Späť na koncept</Link>
    </PageHeader>
    {initial.clientId && !clients.some((client) => client.id === initial.clientId) && <p className="mb-4 text-sm text-amber-800">Pôvodný klient nie je aktívny. Vyberte odberateľa z dostupného adresára.</p>}
    <InvoiceForm clients={clients} issuers={issuers} catalog={catalog} backHref={`/financie/faktury/${id}`} canConfigure={hasFinancePermission(user.role, "CONFIGURE")} initial={initial} action={updateManualInvoice.bind(null, id)} editing />
  </>;
}
