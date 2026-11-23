import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { canScheduleFrom, todaySlovakia } from "@/lib/finance/recurring/schedule";
import { RecurringForm } from "./RecurringForm";

export default async function NewRecurringPage({ searchParams }: { searchParams: Promise<{ faktura?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { faktura } = await searchParams;
  if (typeof faktura !== "string" || !faktura || faktura.length > 100) notFound();
  const invoice = await prisma.invoice.findUnique({ where: { id: faktura } });
  if (!invoice || !canScheduleFrom(invoice)) notFound();
  return <>
    <PageHeader title="Pravidelná fakturácia" subtitle={`Vzorová faktúra ${invoice.invoiceNumber ?? ""}`}>
      <Link href={`/financie/faktury/${invoice.id}`} className={btnSecondary}>Späť na vzor</Link>
    </PageHeader>
    <RecurringForm sourceId={invoice.id} submissionKey={randomUUID()} today={todaySlovakia().toISOString().slice(0, 10)} />
  </>;
}
