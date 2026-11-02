import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { InvoiceForm } from "./InvoiceForm";

export default async function NovaFakturaPage() {
  const clients = await prisma.client.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true },
  });

  return (
    <>
      <PageHeader title="Nová faktúra" subtitle="Ručné vystavenie vydanej faktúry">
        <Link href="/financie/faktury" className={btnSecondary}>
          ← Späť na faktúry
        </Link>
      </PageHeader>

      <InvoiceForm clients={clients} />
    </>
  );
}
