import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { getMaterialStockLevels, getProductStockLevels, type StockLevel } from "@/lib/stock";
import { formatQty } from "@/lib/format";
import { btnPrimary, btnSecondary, card, cardHeader, table, thead, th, thRight, tr, td, tdRight, tdRightMuted } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";

function StockTable({ title, levels }: { title: string; levels: StockLevel[] }) {
  return (
    <div className={card}>
      <div className={cardHeader}>{title}</div>
      <table className={table}>
        <thead>
          <tr className={thead}>
            <th className={th}>Názov</th>
            <th className={thRight}>Na sklade</th>
            <th className={thRight}>Min. zásoba</th>
            <th className={thRight}>Stav</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((item) => (
            <tr key={item.id} className={tr}>
              <td className={td}>{item.name}</td>
              <td className={tdRight}>{formatQty(item.quantity, item.unit)}</td>
              <td className={tdRightMuted}>{formatQty(item.minStock, item.unit)}</td>
              <td className="px-[18px] py-[9px] text-right">
                {item.isLow ? <Badge color="red">Nízky stav</Badge> : <Badge color="emerald">OK</Badge>}
              </td>
            </tr>
          ))}
          {levels.length === 0 && (
            <tr className={tr}>
              <td colSpan={4} className="px-[18px] py-8 text-center text-stone-400">
                Žiadne položky
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function SkladPage() {
  const [materials, products, session] = await Promise.all([
    getMaterialStockLevels(),
    getProductStockLevels(),
    getSession(),
  ]);
  const lowCount = [...materials, ...products].filter((i) => i.isLow).length;

  return (
    <>
      <PageHeader
        title="Sklad"
        subtitle={
          lowCount > 0
            ? `${lowCount} položiek pod minimálnou zásobou`
            : "Všetky zásoby nad minimom"
        }
      >
        {hasFinancePermission(session.role, "VIEW") && <Link href="/dodavatelia/doobjednanie" className={btnSecondary}>
          Doobjednanie zásob
        </Link>}
        <Link href="/sklad/pohyby" className={btnPrimary}>
          Pohyby + nový pohyb
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <StockTable title="Suroviny" levels={materials} />
        <StockTable title="Hotové produkty" levels={products} />
      </div>
    </>
  );
}
