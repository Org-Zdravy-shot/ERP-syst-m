import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, card, input, label, table, thead, tr } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { hasFinancePermission, requireFinancePermission } from "@/lib/finance/permissions";
import { formatCents, formatDate } from "@/lib/format";
import { slovakDateKey } from "../../objednavky/pricing";

const base = "/financie/cenove-ponuky";
export default async function QuoteListPage({ searchParams }: { searchParams: Promise<{ q?: string; subjekt?: string; strana?: string }> }) {
  const actor = await requireFinancePermission("VIEW");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const subject = query.subjekt === "KURGI" || query.subjekt === "SOLE_TRADER" ? query.subjekt : "";
  const page = Number(query.strana) || 1;
  const current = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
  const quotes = await prisma.salesQuote.findMany({
    where: {
      ...(subject ? { legalEntity: subject } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { client: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }], skip: (current - 1) * 40, take: 41,
    select: { id: true, number: true, validUntil: true, status: true, totalGrossCents: true, client: { select: { name: true } } },
  });
  const today = slovakDateKey();
  const href = (page: number) => base + "?" + new URLSearchParams({ subjekt: subject, q, strana: String(page) });
  return <>
    <PageHeader title="Cenové ponuky" subtitle="Ponuky pre odberateľov a nadväzné doklady">
      {hasFinancePermission(actor.role, "CREATE_DRAFT") && <Link className={btnPrimary} href={base + "/novy" + (subject ? "?subjekt=" + subject : "")}>Nová cenová ponuka</Link>}
    </PageHeader>
    <form action={base} className={`${card} mb-4 flex flex-wrap items-end gap-3 p-4`}>
      <label className={label}>Hľadať<input className={input} name="q" type="search" maxLength={100} defaultValue={q} placeholder="Číslo ponuky alebo odberateľ" /></label>
      <label className={label}>Dodávateľ<select className={input} name="subjekt" defaultValue={subject}><option value="">Všetci</option><option value="KURGI">Kurgi</option><option value="SOLE_TRADER">Živnosť</option></select></label>
      <button className={btnSecondary}>Použiť filtre</button>
    </form>
    <div className={`${card} overflow-x-auto`}><table className={table}>
      <thead className={thead}><tr>{["Cenová ponuka","Odberateľ","Platnosť do","Stav","Celkom"].map(title => <th key={title} scope="col" className="px-4 py-3">{title}</th>)}</tr></thead>
      <tbody>{quotes.slice(0,40).map(quote => <tr key={quote.id} className={tr}>
        <td className="px-4 py-3"><Link className="font-semibold hover:underline" href={base + "/" + quote.id}>{quote.number}</Link></td>
        <td className="px-4 py-3">{quote.client.name}</td><td className="px-4 py-3">{formatDate(quote.validUntil)}</td>
        <td className="px-4 py-3">{quote.status === "ACCEPTED" ? "Schválená" : quote.status === "REJECTED" ? "Zamietnutá" : quote.validUntil.toISOString().slice(0,10) < today ? "Expirovaná" : "Čaká na schválenie"}</td>
        <td className="px-4 py-3 tabular-nums">{formatCents(quote.totalGrossCents)}</td>
      </tr>)}
      {!quotes.length && <tr><td colSpan={5} className="p-8 text-center text-stone-600">Žiadne ponuky pre zvolené filtre.</td></tr>}
      </tbody>
    </table></div>
    {(current > 1 || quotes.length > 40) && <nav className="mt-4 flex items-center gap-3" aria-label="Strany cenových ponúk">
      {current > 1 && <Link className={btnSecondary} href={href(current - 1)}>Predošlá</Link>}
      <span>Strana {current}</span>
      {quotes.length > 40 && <Link className={btnSecondary} href={href(current + 1)}>Ďalšia</Link>}
    </nav>}
  </>;
}
