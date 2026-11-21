import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { InvoiceForm } from "../../nova/InvoiceForm";
import { canEditManualDraft, invoiceFormInitial } from "../../invoice-form-data";
import { updateManualInvoice } from "../../../_actions";

export default async function UpravitFakturuPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: { orderBy: { lineNumber: "asc" } } } });
  if (!invoice || !canEditManualDraft(invoice)) notFound();
  const clients = await prisma.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } });
  const initial = invoiceFormInitial(invoice, "edit");
  return <>
    <PageHeader title="Upraviť koncept faktúry" subtitle="Zmeny sa uložia bez vystavenia alebo odoslania dokladu">
      <Link href={`/financie/faktury/${id}`} className={btnSecondary}>← Späť na koncept</Link>
    </PageHeader>
    {initial.clientId && !clients.some((client) => client.id === initial.clientId) && <p className="mb-4 text-sm text-amber-800">Pôvodný klient nie je aktívny. Vyberte odberateľa z dostupného adresára.</p>}
    <InvoiceForm clients={clients} initial={initial} action={updateManualInvoice.bind(null, id)} editing />
  </>;
}
