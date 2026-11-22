import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { HistoricalInvoiceForm } from "./HistoricalInvoiceForm";

export default async function HistoricalInvoicePage({
  searchParams,
}: { searchParams: Promise<{ smer?: string }> }) {
  const { smer } = await searchParams;
  const fromExpenses = smer === "PRIJATA";
  return <>
    <PageHeader title="Historický doklad" subtitle="Evidencia prijatého alebo vydaného originálu bez vystavenia novej faktúry">
      <Link href={fromExpenses ? "/financie/faktury?smer=PRIJATA" : "/financie/faktury"} className={btnSecondary}>
        {fromExpenses ? "← Späť na náklady" : "← Späť na faktúry"}
      </Link>
    </PageHeader>
    <HistoricalInvoiceForm />
  </>;
}
