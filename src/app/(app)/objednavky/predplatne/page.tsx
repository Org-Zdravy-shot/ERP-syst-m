import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { formatDate } from "@/lib/format";
import { createSubscription, generateSubscriptionOrders, toggleSubscriptionActive } from "../_actions";
import { SUBSCRIPTION_FREQUENCY_LABELS } from "../konstanty";
import { GenerateOrdersButton, SubscriptionForm } from "./SubscriptionForm";

export default async function PredplatnePage() {
  const [subscriptions, clients, products] = await Promise.all([
    prisma.subscription.findMany({ include: { client: true, items: { include: { product: true } } }, orderBy: { nextRunDate: "asc" } }),
    prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        productPrices: { select: { productId: true, unitPriceCents: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, sku: true, priceB2bCents: true, priceB2cCents: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Predplatné" subtitle="Opakované objednávky klientov"><GenerateOrdersButton action={generateSubscriptionOrders} /></PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="overflow-x-auto rounded-[14px] border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-stone-50 text-left text-xs uppercase text-stone-500"><th className="px-4 py-3">Klient</th><th className="px-4 py-3">Frekvencia</th><th className="px-4 py-3">Najbližšie</th><th className="px-4 py-3">Položky</th><th className="px-4 py-3">Stav</th><th className="px-4 py-3" /></tr></thead>
            <tbody>
              {subscriptions.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-400">Žiadne predplatné.</td></tr>}
              {subscriptions.map((sub) => {
                const toggle = toggleSubscriptionActive.bind(null, sub.id);
                return <tr key={sub.id} className="border-b border-stone-100 last:border-0"><td className="px-4 py-3 font-medium">{sub.client.name}</td><td className="px-4 py-3 text-stone-600">{SUBSCRIPTION_FREQUENCY_LABELS[sub.frequency] ?? sub.frequency}</td><td className="px-4 py-3 text-stone-600">{formatDate(sub.nextRunDate)}</td><td className="px-4 py-3 text-stone-600">{sub.items.map((item) => `${item.quantity}× ${item.product.name}`).join(", ")}</td><td className="px-4 py-3"><Badge color={sub.isActive ? "emerald" : "gray"}>{sub.isActive ? "Aktívne" : "Pozastavené"}</Badge></td><td className="px-4 py-3"><form action={toggle}><button className="text-sm text-stone-600 hover:underline">{sub.isActive ? "Pozastaviť" : "Aktivovať"}</button></form></td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <SubscriptionForm action={createSubscription} clients={clients} products={products} />
      </div>
    </>
  );
}
