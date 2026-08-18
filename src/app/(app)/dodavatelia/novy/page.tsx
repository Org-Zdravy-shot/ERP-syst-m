import { PageHeader } from "@/components/PageHeader";
import { createSupplier } from "../_actions";
import { SupplierForm } from "../SupplierForm";

export default function NovyDodavatelPage() {
  return (
    <>
      <PageHeader title="Nový dodávateľ" subtitle="Najprv základný profil; kontakty, miesta a ponuky doplníte na detaile." />
      <div className="max-w-4xl">
        <SupplierForm action={createSupplier} submitLabel="Vytvoriť dodávateľa" />
      </div>
    </>
  );
}
