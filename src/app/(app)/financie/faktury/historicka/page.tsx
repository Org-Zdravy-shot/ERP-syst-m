import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { HistoricalInvoiceForm } from "./HistoricalInvoiceForm";

export default function HistoricalInvoicePage() {
  return <>
    <PageHeader title="Historický doklad" subtitle="Evidencia prijatého alebo vydaného originálu bez vystavenia novej faktúry">
      <Link href="/financie/faktury" className={btnSecondary}>← Späť na faktúry</Link>
    </PageHeader>
    <HistoricalInvoiceForm />
  </>;
}
