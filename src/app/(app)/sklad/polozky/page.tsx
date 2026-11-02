import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary, card, cardHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { automaticPackagingMailReady } from "@/lib/suppliers/order-email";
import { MaterialForm } from "./MaterialForm";

export default async function StockItemsPage() {
  const session = await getSession();
  if (!hasFinancePermission(session.role, "CONFIGURE")) redirect("/sklad");
  const items = await prisma.material.findMany({
    where: { isActive: true }, orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { supplierCatalogItems: { where: { isActive: true, isPreferred: true, supplier: { isActive: true } }, include: { supplier: { select: { name: true } } } } },
  });
  const automationEnabled = process.env.SUPPLIER_AUTO_ORDER_ENABLED === "true";
  const mailReady = automaticPackagingMailReady();
  return <>
    <PageHeader title="Suroviny a obaly" subtitle="Každá položka má vlastný stav, limit a väzbu na ponuku dodávateľa"><Link href="/sklad" className={btnSecondary}>← Späť na sklad</Link></PageHeader>
    {!automationEnabled ? <p className="mb-5 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Automatické e-mailové objednávanie obalov je dočasne vypnuté. Po sezóne ho zapne správca systému. Sklad a ručné doobjednanie fungujú ďalej.</p> : !mailReady && <p className="mb-5 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Automatické e-mailové objednávanie je pozastavené, kým nebude potvrdené nastavenie odosielateľa a e-mailového poskytovateľa. Sklad a ručné doobjednanie fungujú ďalej.</p>}
    <div className={`${card} mb-5`}><div className={cardHeader}>Nová skladová položka</div><MaterialForm /></div>
    <p className="mb-4 text-sm text-stone-600">Po založení obalu zapíšte počiatočný stav cez <Link className="underline" href="/sklad/pohyby">skladový príjem</Link>, potom ho prepojte s aktívnou ponukou v <Link className="underline" href="/dodavatelia">profile dodávateľa</Link>. Automatické objednávanie môžete zapnúť až po doplnení e-mailu, preferovanej ponuky a ceny.</p>
    <div className="space-y-4">
      {items.map((item) => <div className={card} key={item.id}><div className={cardHeader}>{item.name} · {item.kind === "PACKAGING" ? "obal" : "surovina"}{item.autoReorder ? " · automatické objednávanie zapnuté" : ""}</div><p className="px-4 pt-3 text-xs text-stone-600">Preferovaný dodávateľ: {item.supplierCatalogItems.length === 1 ? item.supplierCatalogItems[0].supplier.name : item.supplierCatalogItems.length > 1 ? "viac ponúk – vyberte jednu" : "zatiaľ nepriradený"}</p><MaterialForm item={item} /></div>)}
      {items.length === 0 && <div className={`${card} p-6 text-sm text-stone-500`}>Zatiaľ tu nie sú žiadne suroviny ani obaly.</div>}
    </div>
  </>;
}
