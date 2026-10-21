import { PageHeader } from "@/components/PageHeader";
import { ProductForm } from "../ProductForm";
import { createProduct } from "../_actions";

export default function NovyProduktPage() {
  return <><PageHeader title="Nový produkt" subtitle="Pridajte produkt do predajného katalógu." /><ProductForm action={createProduct} /></>;
}
