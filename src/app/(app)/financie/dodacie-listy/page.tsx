import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, card, input, label, table, thead, tr } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { hasFinancePermission, requireFinancePermission } from "@/lib/finance/permissions";
import { invoiceKeepsDelivery } from "@/lib/finance/delivery/schema";
import { prisma } from "@/lib/prisma";
import { legalEntityLabels } from "@/lib/zod-schemas";

const PAGE_SIZE = 40;
const path = "/financie/dodacie-listy";

export default async function DeliveryNotesPage({ searchParams }: {
  searchParams: Promise<{ q?: string; subjekt?: string; stav?: string; strana?: string }>;
}) {
  const actor = await requireFinancePermission("VIEW");
  const canCreate = hasFinancePermission(actor.role, "CREATE_DRAFT");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const entity = params.subjekt === "KURGI" || params.subjekt === "SOLE_TRADER" ? params.subjekt : "";
  const status = params.stav === "volne" || params.stav === "fakturovane" || params.stav === "zrusene" ? params.stav : "";
  const requestedPage = Number(params.strana ?? 1);
  const reservation = { invoice: { OR: [...invoiceKeepsDelivery.OR] } };
  const where: Prisma.DeliveryNoteWhereInput = {
    ...(entity ? { legalEntity: entity } : {}),
    ...(status === "volne" ? { cancelledAt: null, invoiceLinks: { none: reservation } } : {}),
    ...(status === "fakturovane" ? { invoiceLinks: { some: reservation } } : {}),
    ...(status === "zrusene" ? { cancelledAt: { not: null } } : {}),
    ...(q ? { OR: [
      { number: { contains: q, mode: "insensitive" } },
      { buyerOrderNumber: { contains: q, mode: "insensitive" } },
      { supplierOrderNumber: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  };
  const count = await prisma.deliveryNote.count({ where });
  const lastPage = Math.max(Math.ceil(count / PAGE_SIZE), 1);
  const current = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, lastPage)) : 1;
  const notes = await prisma.deliveryNote.findMany({
    where, orderBy: [{ deliveryDate: "desc" }, { number: "desc" }],
    skip: PAGE_SIZE * (current - 1), take: PAGE_SIZE,
    select: {
      id: true, number: true, legalEntity: true, deliveryDate: true, cancelledAt: true, supplierOrderNumber: true,
      client: { select: { name: true } },
      invoiceLinks: { where: reservation, take: 1, include: { invoice: { select: { id: true, invoiceNumber: true, documentStatus: true } } } },
    },
  });
  function pageHref(page: number) {
    return path + "?" + new URLSearchParams({ q, subjekt: entity, stav: status, strana: String(page) });
  }

  return <>
    <PageHeader title="Dodacie listy" subtitle="Vystavené dodania a súvisiace faktúry">
      {canCreate && <Link className={btnPrimary} href={entity ? `${path}/novy?subjekt=${entity}` : `${path}/novy`}>Nový dodací list</Link>}
    </PageHeader>
    <form action={path} className={`${card} mb-5 grid items-end gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr_auto]`}>
      <label className={label}>Hľadať<input className={input} type="search" name="q" defaultValue={q} maxLength={100} placeholder="Číslo, odberateľ alebo objednávka" /></label>
      <label className={label}>Dodávateľ<select className={input} name="subjekt" defaultValue={entity}><option value="">Všetci</option>{Object.entries(legalEntityLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className={label}>Stav<select className={input} name="stav" defaultValue={status}><option value="">Všetky</option><option value="volne">Na fakturáciu</option><option value="fakturovane">S faktúrou alebo konceptom</option><option value="zrusene">Zrušené</option></select></label>
      <button type="submit" className={btnSecondary}>Použiť filtre</button>
    </form>
    <form action={`${path}/fakturovat`} className={card}>
      {canCreate && notes.some(note => !note.cancelledAt && !note.invoiceLinks.length) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 p-4">
          <p className="text-sm text-stone-600">Označte dodacie listy pre jednu faktúru.</p><button type="submit" className={btnSecondary}>Fakturovať vybrané</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={table}>
          <thead className={thead}><tr>{canCreate && <th className="px-4 py-3" scope="col">Výber</th>}<th scope="col" className="px-4 py-3">Dodací list</th><th scope="col" className="px-4 py-3">Odberateľ</th><th scope="col" className="px-4 py-3">Dodanie</th><th scope="col" className="px-4 py-3">Faktúra</th></tr></thead>
          <tbody>
            {notes.map(note => {
              const linked = note.invoiceLinks[0]?.invoice;
              return <tr key={note.id} className={tr}>
                {canCreate && <td className="px-4 py-3"><input name="dl" value={note.id} type="checkbox" disabled={!!linked || !!note.cancelledAt} aria-label={`Vybrať ${note.number}`} /></td>}
                <td className="px-4 py-3"><Link href={`${path}/${note.id}`} className="font-semibold underline-offset-4 hover:underline">{note.number}</Link>{note.supplierOrderNumber && <div className="text-xs text-stone-500">{note.supplierOrderNumber}</div>}</td>
                <td className="px-4 py-3">{note.client.name}<div className="text-xs text-stone-500">{legalEntityLabels[note.legalEntity]}</div></td>
                <td className="px-4 py-3">{formatDate(note.deliveryDate)}</td>
                <td className="px-4 py-3">{linked ? <Link className="underline-offset-4 hover:underline" href={`/financie/faktury/${linked.id}`}>{linked.documentStatus === "CANCELLED" ? "Storno · " : ""}{linked.invoiceNumber ?? "Koncept"}</Link> : note.cancelledAt ? "Zrušený" : "Na fakturáciu"}</td>
              </tr>;
            })}
            {!notes.length && <tr><td colSpan={canCreate ? 5 : 4} className="px-4 py-10 text-center text-stone-600">Žiadne dodacie listy pre zvolené filtre.</td></tr>}
          </tbody>
        </table>
      </div>
    </form>
    {lastPage > 1 && <nav className="mt-3 flex items-center gap-3 text-sm" aria-label="Strany dodacích listov">
      {current > 1 && <Link className={btnSecondary} href={pageHref(current - 1)}>Predošlá</Link>}
      <span>Strana {current} z {lastPage}</span>
      {current < lastPage && <Link className={btnSecondary} href={pageHref(current + 1)}>Ďalšia</Link>}
    </nav>}
  </>;
}
