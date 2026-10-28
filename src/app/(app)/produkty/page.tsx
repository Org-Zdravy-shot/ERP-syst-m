import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSmall, card, table, td, thead, tr } from "@/components/ui";
import { formatCents } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export default async function ProduktyPage() {
  const products = await prisma.product.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="Produkty" subtitle="Katalóg produktov ponúkaných na predaj. Výroba sa eviduje samostatne.">
        <Link href="/produkty/nova" className={btnPrimary}>+ Nový produkt</Link>
      </PageHeader>
      <div className={`${card} overflow-x-auto`}>
        <table className={table}>
          <thead><tr className={thead}>
            <th className="px-[18px] py-3 font-medium">Produkt</th>
            <th className="px-[18px] py-3 font-medium">SKU</th>
            <th className="px-[18px] py-3 text-right font-medium">B2C bez DPH v objednávke</th>
            <th className="px-[18px] py-3 font-medium">Stav</th>
            <th className="px-[18px] py-3 font-medium">Akcia</th>
          </tr></thead>
          <tbody>
            {products.map((product) => <tr key={product.id} className={tr}>
              <td className={td}>{product.name}</td>
              <td className={td}>{product.sku}</td>
              <td className={`${td} text-right`}>{formatCents(product.priceB2cCents)}</td>
              <td className={td}>{product.isActive ? "Aktívny" : "Neaktívny"}</td>
              <td className={td}><Link href={`/produkty/${product.id}/upravit`} className={btnSmall}>Upraviť</Link></td>
            </tr>)}
            {products.length === 0 && <tr className={tr}><td colSpan={5} className="px-5 py-8 text-center text-stone-500">Zatiaľ žiadne produkty. Pridajte prvý produkt.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
