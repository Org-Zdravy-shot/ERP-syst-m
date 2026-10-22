import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Badge, ORDER_STATUS_COLORS } from "@/components/Badge";
import { formatCents, formatDate } from "@/lib/format";
import { computeTotals } from "@/lib/invoicing";
import { orderStatusLabels, orderChannelLabels } from "@/lib/zod-schemas";
import { bratislavaDateTimeToIso } from "@/lib/datetime";

const PAGE_SIZE = 25;

function todayBounds() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: new Date(bratislavaDateTimeToIso(year, month, day)),
    end: new Date(bratislavaDateTimeToIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())),
  };
}

function orderHref(view: string, search: string, page = 1) {
  const params = new URLSearchParams();
  if (view in orderStatusLabels) params.set("stav", view);
  else if (view !== "vsetky") params.set("pohlad", view);
  if (search) params.set("hladat", search);
  if (page > 1) params.set("strana", String(page));
  const query = params.toString();
  return `/objednavky${query ? `?${query}` : ""}`;
}

export default async function ObjednavkyPage({
  searchParams,
}: {
  searchParams: Promise<{ stav?: string; pohlad?: string; hladat?: string; strana?: string }>;
}) {
  const { stav, pohlad, hladat, strana } = await searchParams;
  const statusFilter = stav && stav in orderStatusLabels ? stav : undefined;
  const view = statusFilter ?? (["dnes", "meska", "nove", "expedicia"].includes(pohlad ?? "") ? pohlad! : "vsetky");
  const search = (hladat ?? "").trim().slice(0, 100);
  const requestedPage = Number(strana);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { start, end } = todayBounds();
  const openStatuses = ["NOVA", "POTVRDENA", "VO_VYROBE"];
  const viewWhere: Prisma.OrderWhereInput = statusFilter
    ? { status: statusFilter }
    : view === "dnes"
      ? { status: { in: openStatuses }, deliveryDate: { gte: start, lt: end } }
      : view === "meska"
        ? { status: { in: openStatuses }, deliveryDate: { lt: start } }
        : view === "nove"
          ? { status: "NOVA" }
          : view === "expedicia"
            ? { status: { in: ["POTVRDENA", "VO_VYROBE"] } }
            : {};
  const where: Prisma.OrderWhereInput = {
    AND: [viewWhere, search ? {
      OR: [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { items: { some: { product: { name: { contains: search, mode: "insensitive" } } } } },
      ],
    } : {}],
  };

  const [total, newInboxCount, dueToday, overdue, newOrders, toShip] = await Promise.all([
    prisma.order.count({ where }),
    prisma.inboxMessage.count({ where: { status: "NOVA" } }),
    prisma.order.count({ where: { status: { in: openStatuses }, deliveryDate: { gte: start, lt: end } } }),
    prisma.order.count({ where: { status: { in: openStatuses }, deliveryDate: { lt: start } } }),
    prisma.order.count({ where: { status: "NOVA" } }),
    prisma.order.count({ where: { status: { in: ["POTVRDENA", "VO_VYROBE"] } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const orders = await prisma.order.findMany({
    where,
    include: {
      client: { select: { name: true } },
      items: { include: { product: { select: { name: true, isActive: true } } } },
      invoices: { select: { id: true } },
    },
    orderBy: ["dnes", "meska", "expedicia"].includes(view)
      ? [{ deliveryDate: { sort: "asc", nulls: "last" } }, { orderDate: "desc" }, { id: "desc" }]
      : [{ orderDate: "desc" }, { id: "desc" }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const productIds = [...new Set(orders.flatMap((order) => order.items.map((item) => item.productId)))];
  const stockSums = productIds.length ? await prisma.stockMovement.groupBy({
    by: ["productId"], where: { productId: { in: productIds } }, _sum: { quantity: true },
  }) : [];
  const stock = new Map(stockSums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  return (
    <>
      <PageHeader title="Objednávky" subtitle="Manuálne, web, e-mail a predplatné">
        <Link
          href="/objednavky/inbox"
          className="relative rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          📥 Inbox
          {newInboxCount > 0 && (
            <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
              {newInboxCount}
            </span>
          )}
        </Link>
        <Link
          href="/objednavky/predplatne"
          className="rounded-[10px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          🔁 Predplatné
        </Link>
        <Link
          href="/objednavky/nova"
          className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-brand-dark"
        >
          + Nová objednávka
        </Link>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { key: "dnes", label: "Dodať dnes", count: dueToday },
          { key: "meska", label: "Po termíne", count: overdue },
          { key: "nove", label: "Potvrdiť", count: newOrders },
          { key: "expedicia", label: "Pripraviť / expedovať", count: toShip },
        ].map((item) => (
          <Link key={item.key} href={orderHref(item.key, search)} className={`rounded-[14px] border p-4 ${view === item.key ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white text-stone-900 hover:border-stone-400"}`}>
            <span className="block text-xs">{item.label}</span>
            <strong className="mt-1 block text-2xl">{item.count}</strong>
          </Link>
        ))}
      </div>

      <form method="get" className="mb-4 flex max-w-xl gap-2">
        {view !== "vsetky" && <input type="hidden" name={statusFilter ? "stav" : "pohlad"} value={view} />}
        <input name="hladat" defaultValue={search} maxLength={100} placeholder="Číslo, klient alebo produkt" aria-label="Hľadať objednávky" className="min-w-0 flex-1 rounded-[10px] border border-stone-300 px-3 py-2 text-sm" />
        <button className="rounded-[10px] bg-stone-950 px-4 py-2 text-sm font-medium text-white">Hľadať</button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={orderHref("vsetky", search)}
          className={`rounded-full px-3 py-1 text-sm transition ${
            view === "vsetky" ? "bg-stone-950 font-medium text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
          }`}
        >
          Všetky
        </Link>
        {Object.entries(orderStatusLabels).map(([value, label]) => (
          <Link
            key={value}
            href={`/objednavky?stav=${value}${search ? `&hladat=${encodeURIComponent(search)}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm transition ${
              view === value ? "bg-stone-950 font-medium text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3">Číslo</th>
              <th className="px-4 py-3">Klient</th>
              <th className="px-4 py-3">Dátum</th>
              <th className="px-4 py-3">Dodanie</th>
              <th className="px-4 py-3">Kanál</th>
              <th className="px-4 py-3">Stav</th>
              <th className="px-4 py-3 text-right">Položky</th>
              <th className="px-4 py-3 text-right">Suma s DPH</th>
              <th className="px-4 py-3">Faktúra</th>
              <th className="px-4 py-3">Upozornenie</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-stone-400">Žiadne objednávky.</td>
              </tr>
            )}
            {orders.map((order) => {
              const totals = computeTotals(order.items);
              const required = new Map<string, number>();
              for (const item of order.items) required.set(item.productId, (required.get(item.productId) ?? 0) + item.quantity);
              const alerts = [
                ...order.items.filter((item) => item.unitPriceCents === 0).map((item) => `Skontrolovať cenu: ${item.product.name}`),
                ...order.items.filter((item) => !item.product.isActive).map((item) => `Neaktívny produkt: ${item.product.name}`),
                ...[...required].filter(([productId, quantity]) => (stock.get(productId) ?? 0) < quantity && ["POTVRDENA", "VO_VYROBE"].includes(order.status)).map(([productId, quantity]) => `${order.items.find((item) => item.productId === productId)?.product.name}: zásoba ${stock.get(productId) ?? 0}/${quantity} ks`),
              ];
              return (
                <tr key={order.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/objednavky/${order.id}`} className="font-medium text-stone-950 hover:underline">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/klienti/${order.clientId}`} className="text-stone-700 hover:underline">
                      {order.client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{formatDate(order.orderDate)}</td>
                  <td className="px-4 py-3 text-stone-600">{formatDate(order.deliveryDate)}</td>
                  <td className="px-4 py-3 text-stone-600">{orderChannelLabels[order.channel] ?? order.channel}</td>
                  <td className="px-4 py-3">
                    <Badge color={ORDER_STATUS_COLORS[order.status]}>{orderStatusLabels[order.status] ?? order.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-stone-600">{order.items.length}</td>
                  <td className="px-4 py-3 text-right font-medium text-stone-900">{formatCents(totals.totalGrossCents)}</td>
                  <td className="px-4 py-3 text-stone-600">{order.invoices.length > 0 ? "✓" : "—"}</td>
                  <td className="px-4 py-3 text-xs text-amber-800">{alerts.length ? alerts.join(" · ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-stone-600">
        <span>{total} objednávok · strana {currentPage} z {pages}</span>
        <div className="flex gap-2">
          {currentPage > 1 && <Link className="rounded border border-stone-300 px-3 py-1" href={orderHref(view, search, currentPage - 1)}>← Predchádzajúca</Link>}
          {currentPage < pages && <Link className="rounded border border-stone-300 px-3 py-1" href={orderHref(view, search, currentPage + 1)}>Ďalšia →</Link>}
        </div>
      </div>
    </>
  );
}
