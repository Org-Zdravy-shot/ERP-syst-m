import Form from "next/form";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, card, filterPill, table, td, tdMuted, tdRight, th, thRight, thead, tr } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { supplierSourceLabels } from "@/lib/zod-schemas";

const SOURCES = ["REFERRAL", "WEB", "FAIR", "MARKETPLACE", "EXISTING", "OTHER"] as const;

export default async function DodavateliaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; zdroj?: string; neaktivni?: string }>;
}) {
  const { q: rawQuery, zdroj, neaktivni } = await searchParams;
  const q = rawQuery?.trim().slice(0, 100) ?? "";
  const source = SOURCES.find((value) => value === zdroj);
  const showInactive = neaktivni === "1";

  const [suppliers, activeCount, openOrderCount, contactCount] = await Promise.all([
    prisma.supplier.findMany({
      where: {
        ...(showInactive ? {} : { isActive: true }),
        ...(source ? { source } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { legalName: { contains: q, mode: "insensitive" as const } },
                { ico: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
                { contacts: { some: { name: { contains: q, mode: "insensitive" as const } } } },
                { contacts: { some: { email: { contains: q, mode: "insensitive" as const } } } },
                { locations: { some: { city: { contains: q, mode: "insensitive" as const } } } },
                { tags: { some: { name: { contains: q, mode: "insensitive" as const } } } },
              ],
            }
          : {}),
      },
      include: {
        contacts: { where: { isPrimary: true }, take: 1 },
        locations: { where: { isPrimary: true }, take: 1 },
        tags: { orderBy: { name: "asc" } },
        _count: { select: { catalogItems: true, contacts: true, locations: true, orders: true } },
        orders: {
          where: { status: { notIn: ["RECEIVED", "CANCELLED"] } },
          select: { id: true },
        },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.supplierOrder.count({ where: { status: { notIn: ["RECEIVED", "CANCELLED"] } } }),
    prisma.supplierContact.count(),
  ]);

  const sourceHref = (value?: string, includeInactive = showInactive) => {
    const params = new URLSearchParams();
    if (value) params.set("zdroj", value);
    if (q) params.set("q", q);
    if (includeInactive) params.set("neaktivni", "1");
    return params.size ? `/dodavatelia?${params}` : "/dodavatelia";
  };

  return (
    <>
      <PageHeader title="Dodávatelia" subtitle="Kontakty, ponuky, nákupy, záväzky a vratné obaly">
        <Link href="/dodavatelia/objednavky" className={btnSecondary}>Nákupné objednávky</Link>
        <Link href="/dodavatelia/novy" className={btnPrimary}>+ Nový dodávateľ</Link>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={`${card} p-4`}>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-400">Aktívni dodávatelia</div>
          <div className="mt-1 text-2xl font-bold text-stone-950">{activeCount}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-400">Otvorené nákupné objednávky</div>
          <div className="mt-1 text-2xl font-bold text-stone-950">{openOrderCount}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-400">Kontaktné osoby</div>
          <div className="mt-1 text-2xl font-bold text-stone-950">{contactCount}</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={sourceHref()} className={filterPill(!source)}>Všetci</Link>
        {SOURCES.map((value) => (
          <Link key={value} href={sourceHref(value)} className={filterPill(source === value)}>
            {supplierSourceLabels[value]}
          </Link>
        ))}
        <Form action="/dodavatelia" className="ml-auto flex gap-2">
          {source && <input type="hidden" name="zdroj" value={source} />}
          {showInactive && <input type="hidden" name="neaktivni" value="1" />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Názov, IČO, kontakt, mesto…"
            className="w-72 rounded-[10px] border border-stone-300 px-3 py-1.5 text-sm focus:border-stone-950 focus:outline-none focus:ring-[3px] focus:ring-brand/35"
          />
        </Form>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className={table}>
          <thead>
            <tr className={thead}>
              <th className={th}>Dodávateľ</th>
              <th className={th}>Kontakt</th>
              <th className={th}>Miesto</th>
              <th className={th}>Zdroj</th>
              <th className={th}>Štítky</th>
              <th className={thRight}>Ponuky</th>
              <th className={thRight}>Otvorené objednávky</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => {
              const contact = supplier.contacts[0];
              const location = supplier.locations[0];
              return (
                <tr key={supplier.id} className={tr}>
                  <td className={td}>
                    <Link href={`/dodavatelia/${supplier.id}`} className="font-semibold hover:underline">
                      {supplier.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-stone-400">
                      {supplier.ico ? `IČO ${supplier.ico}` : supplier.kind === "PERSON" ? "Fyzická osoba" : "Firma"}
                      {!supplier.isActive && " · neaktívny"}
                    </div>
                  </td>
                  <td className={tdMuted}>
                    <div>{contact?.name ?? supplier.email ?? "—"}</div>
                    {contact?.role && <div className="text-xs text-stone-400">{contact.role}</div>}
                  </td>
                  <td className={tdMuted}>{location?.city ?? "—"}</td>
                  <td className={tdMuted}>{supplierSourceLabels[supplier.source] ?? supplier.source}</td>
                  <td className={td}>
                    <div className="flex max-w-60 flex-wrap gap-1">
                      {supplier.tags.slice(0, 3).map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}
                      {supplier.tags.length > 3 && <Badge>+{supplier.tags.length - 3}</Badge>}
                    </div>
                  </td>
                  <td className={tdRight}>{supplier._count.catalogItems}</td>
                  <td className={tdRight}>{supplier.orders.length}</td>
                </tr>
              );
            })}
            {suppliers.length === 0 && (
              <tr className={tr}>
                <td colSpan={7} className="px-5 py-14 text-center text-stone-400">
                  <p>Žiadni dodávatelia nezodpovedajú filtru.</p>
                  {!q && !source && <Link href="/dodavatelia/novy" className="mt-3 inline-block font-semibold text-stone-700 hover:underline">Pridať prvého dodávateľa</Link>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-sm text-stone-500">
        <Link href={sourceHref(source, !showInactive)} className="hover:underline">
          {showInactive ? "Skryť neaktívnych" : "Zobraziť aj neaktívnych"}
        </Link>
      </div>
    </>
  );
}
