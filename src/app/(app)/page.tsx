import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate, formatQty } from "@/lib/format";
import { getLowStockItems } from "@/lib/stock";
import { actualsFor, fulfillmentPct, getMonthlyActualsMap } from "@/lib/reporting";
import { orderStatusLabels } from "@/lib/zod-schemas";
import { getSession } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-stone-200 border-t-[3px] border-t-brand bg-white px-5 py-[18px]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{label}</div>
      <div className="mt-2 whitespace-nowrap font-display text-[22px] font-bold text-stone-950">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-400">{hint}</div>}
    </div>
  );
}

function SectionCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-stone-200 bg-white">
      <div className="flex items-center justify-between gap-2.5 border-b border-stone-100 px-[18px] py-[13px]">
        <span className="min-w-0 text-[13.5px] font-semibold text-stone-950">{title}</span>
        <Link
          href={href}
          className="shrink-0 whitespace-nowrap text-xs font-semibold text-stone-950 transition hover:text-brand-dark"
        >
          Zobraziť →
        </Link>
      </div>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  const canViewFinance = hasFinancePermission(session.role, "VIEW");
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  const [actualsMap, lowStock, openOrdersCount, recentOrders, expiringBatches, currentPlan] =
    await Promise.all([
      canViewFinance ? getMonthlyActualsMap() : Promise.resolve(new Map()),
      getLowStockItems(),
      prisma.order.count({ where: { status: { in: ["NOVA", "POTVRDENA", "VO_VYROBE"] } } }),
      prisma.order.findMany({
        orderBy: { orderDate: "desc" },
        take: 5,
        include: { client: { select: { name: true } } },
      }),
      prisma.productionBatch.findMany({
        where: { status: "DONE", expiryDate: { lte: in7Days } },
        orderBy: { expiryDate: "asc" },
        take: 5,
        include: { product: { select: { name: true } } },
      }),
      canViewFinance
        ? prisma.monthlyPlan.findUnique({
            where: { year_month: { year: now.getFullYear(), month: now.getMonth() + 1 } },
          })
        : Promise.resolve(null),
    ]);

  const actuals = actualsFor(actualsMap, now.getFullYear(), now.getMonth() + 1);
  const lowStockCount = lowStock.materials.length + lowStock.products.length;
  const planPct = currentPlan
    ? fulfillmentPct(actuals.revenueCents, currentPlan.targetRevenueCents)
    : null;

  return (
    <>
      <PageHeader title="Prehľad" subtitle="Kľúčové ukazovatele firmy Zdravý shot" />

      <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canViewFinance && (
          <KpiCard
            label="Evidované predaje tento mesiac"
            value={formatCents(actuals.revenueCents)}
            hint="vydané faktúry + nespárovaná eKasa"
          />
        )}
        <KpiCard label="Otvorené objednávky" value={String(openOrdersCount)} hint="nové, potvrdené, vo výrobe" />
        <KpiCard
          label="Nízke zásoby"
          value={String(lowStockCount)}
          hint={lowStockCount > 0 ? "položiek pod minimom" : "všetko nad minimom"}
        />
        {canViewFinance && (
          <KpiCard
            label="Plnenie plánu"
            value={planPct !== null ? `${planPct} %` : "—"}
            hint={currentPlan ? `cieľ ${formatCents(currentPlan.targetRevenueCents)}` : "plán nie je nastavený"}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <SectionCard title="Nízke zásoby" href="/sklad">
          <ul className="text-[13.5px]">
            {[...lowStock.materials, ...lowStock.products].slice(0, 6).map((item) => (
              <li
                key={item.id}
                className="flex justify-between border-b border-stone-100 px-[18px] py-2.5 last:border-b-0"
              >
                <span className="text-stone-950">{item.name}</span>
                <span className="tabular-nums text-red-500">
                  {formatQty(item.quantity, item.unit)}{" "}
                  <span className="text-stone-400">/ min {formatQty(item.minStock)}</span>
                </span>
              </li>
            ))}
            {lowStockCount === 0 && (
              <li className="px-[18px] py-6 text-center text-stone-400">Všetky zásoby sú nad minimom 🎉</li>
            )}
          </ul>
        </SectionCard>

        <SectionCard title="Blížiace exspirácie (7 dní)" href="/vyroba">
          <ul className="text-[13.5px]">
            {expiringBatches.map((batch) => (
              <li
                key={batch.id}
                className="flex justify-between border-b border-stone-100 px-[18px] py-2.5 last:border-b-0"
              >
                <span className="text-stone-950">
                  {batch.batchNumber} <span className="text-stone-400">· {batch.product.name}</span>
                </span>
                <span className="tabular-nums text-amber-700">{formatDate(batch.expiryDate)}</span>
              </li>
            ))}
            {expiringBatches.length === 0 && (
              <li className="px-[18px] py-6 text-center text-stone-400">Žiadne šarže neexspirujú do 7 dní</li>
            )}
          </ul>
        </SectionCard>

        <SectionCard title="Posledné objednávky" href="/objednavky">
          <ul className="text-[13.5px]">
            {recentOrders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between border-b border-stone-100 px-[18px] py-2.5 last:border-b-0"
              >
                <span className="text-stone-950">
                  {order.orderNumber} <span className="text-stone-400">· {order.client.name}</span>
                </span>
                <span className="rounded-full bg-stone-100 px-[9px] py-0.5 text-[11px] font-semibold text-stone-600">
                  {orderStatusLabels[order.status] ?? order.status}
                </span>
              </li>
            ))}
            {recentOrders.length === 0 && (
              <li className="px-[18px] py-6 text-center text-stone-400">Zatiaľ žiadne objednávky</li>
            )}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
