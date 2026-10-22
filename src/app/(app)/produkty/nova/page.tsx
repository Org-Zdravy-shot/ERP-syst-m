import { PageHeader } from "@/components/PageHeader";
import { ProductForm } from "../ProductForm";
import { createProduct } from "../_actions";

export default async function NovyProduktPage({ searchParams }: {
  searchParams: Promise<{ zObjednavky?: string; klient?: string; inbox?: string }>;
}) {
  const params = await searchParams;
  const orderReturn = params.zObjednavky === "1" ? {
    klient: params.klient?.slice(0, 100),
    inbox: params.inbox?.slice(0, 100),
  } : undefined;
  return <><PageHeader title="Nový produkt" subtitle="Pridajte produkt do predajného katalógu." /><ProductForm action={createProduct} orderReturn={orderReturn} /></>;
}
