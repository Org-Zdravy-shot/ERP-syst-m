import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { ProductForm } from "../../ProductForm";
import { updateProduct } from "../../_actions";

export default async function UpravitProduktPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ulozene?: string }>;
}) {
  const { id } = await params;
  const { ulozene } = await searchParams;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();
  return <>
    <PageHeader title="Upraviť produkt" subtitle={product.name} />
    {ulozene === "1" && <div role="status" className="mb-4 flex max-w-2xl items-center justify-between gap-3 rounded-[10px] bg-green-50 px-4 py-3 text-sm text-green-800"><span>Produkt je uložený. {product.isActive ? "Môžete ho vybrať v novej objednávke." : "Neaktívny produkt sa v novej objednávke neponúka."}</span>{product.isActive && <Link href="/objednavky/nova" className={btnSecondary}>Nová objednávka</Link>}</div>}
    <ProductForm action={updateProduct.bind(null, id)} product={product} />
  </>;
}
