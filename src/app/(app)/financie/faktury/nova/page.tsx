import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { InvoiceForm } from "./InvoiceForm";
import { notFound } from "next/navigation";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { canCopyInvoice, invoiceFormInitial } from "../invoice-form-data";

export default async function NovaFakturaPage({ searchParams }: { searchParams: Promise<{ copyFrom?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { copyFrom } = await searchParams;
  const original = typeof copyFrom === "string" && copyFrom.length <= 100 ? await prisma.invoice.findUnique({ where: { id: copyFrom }, include: { items: { orderBy: { lineNumber: "asc" } } } }) : null;
  if (copyFrom && (!original || !canCopyInvoice(original))) notFound();
  const initial = original ? invoiceFormInitial(original, "copy") : undefined;
  const clients = await prisma.client.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true },
  });

  return (
    <>
      <PageHeader title={original ? "Kópia faktúry" : "Nová faktúra"} subtitle="Ručné vystavenie vydanej faktúry">
        <Link href="/financie/faktury" className={btnSecondary}>
          ← Späť na faktúry
        </Link>
      </PageHeader>

      {original && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-stone-800">Kópia dokladu {original.invoiceNumber ?? "bez čísla"}. Skontrolujte dátumy, ceny a odberateľa. Referencie objednávok, dodacie listy, šarže a exspirácie vyplňte pre nové dodanie. Nový koncept vznikne až uložením.</p>}
      {initial?.clientId && !clients.some((client) => client.id === initial.clientId) && <p className="mb-4 text-sm text-amber-800">Pôvodný klient nie je aktívny. Vyberte odberateľa z dostupného adresára.</p>}
      <InvoiceForm clients={clients} initial={initial} />
    </>
  );
}
