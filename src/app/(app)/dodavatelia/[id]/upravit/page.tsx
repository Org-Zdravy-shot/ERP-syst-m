import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { updateSupplier } from "../../_actions";
import { SupplierForm } from "../../SupplierForm";

export default async function UpravitDodavatelaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { tags: { orderBy: { name: "asc" } } },
  });
  if (!supplier) notFound();
  const action = updateSupplier.bind(null, supplier.id);

  return (
    <>
      <PageHeader title={`Upraviť: ${supplier.name}`} subtitle="Právne, kontaktné a interné údaje dodávateľa" />
      <div className="max-w-4xl">
        <SupplierForm
          action={action}
          submitLabel="Uložiť zmeny"
          initial={{
            ...supplier,
            tags: supplier.tags.map((tag) => tag.name),
          }}
        />
      </div>
    </>
  );
}
