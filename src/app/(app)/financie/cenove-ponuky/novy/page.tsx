import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { requireFinancePermission } from "@/lib/finance/permissions";
import { CommercialDocumentForm } from "../../CommercialDocumentForm";
import { invoiceFormOptions } from "../../faktury/form-options";
import { slovakDateKey } from "../../../objednavky/pricing";
import { issueQuoteAction } from "../_actions";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ subjekt?: string }> }) {
  await requireFinancePermission("CREATE_DRAFT");
  const { subjekt } = await searchParams;
  const { clients, catalog } = await invoiceFormOptions();
  const today = slovakDateKey();
  const expires = new Date(new Date(today).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  return <>
    <PageHeader title="Cenové ponuky"><Link href="/financie/cenove-ponuky" className={btnSecondary}>Späť na zoznam</Link></PageHeader>
    <CommercialDocumentForm clients={clients} products={catalog} mode="quote" saveAction={issueQuoteAction}
      submissionKey={randomUUID()} today={today} deliveryDate={expires}
      defaultIssuer={subjekt === "KURGI" || subjekt === "SOLE_TRADER" ? subjekt : undefined} />
  </>;
}
