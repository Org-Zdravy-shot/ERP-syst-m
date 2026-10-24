import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { OrderForm, type OrderFormInitial } from "../OrderForm";
import { createOrder } from "../_actions";

const priceRuleSelect = {
  productId: true, effectiveFrom: true, version: true, kind: true,
  unitPriceCents: true, discountBps: true,
} as const;

export default async function NovaObjednavkaPage({
  searchParams,
}: {
  searchParams: Promise<{ klient?: string; inbox?: string; produkt?: string }>;
}) {
  const { klient, inbox, produkt } = await searchParams;

  const [clients, products] = await Promise.all([
    prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        productPrices: { select: { productId: true, unitPriceCents: true } },
        priceRules: { select: priceRuleSelect },
      },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, priceB2bCents: true, priceB2cCents: true, vatRate: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const clientsForForm = clients.map((client) => ({
    ...client,
    priceRules: client.priceRules.map((rule) => ({ ...rule, effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10) })),
  }));

  const initial: OrderFormInitial = { clientId: klient };
  let inboxMessageId: string | undefined;
  let inboxInfo: { subject: string | null; fromEmail: string | null } | undefined;

  if (inbox) {
    const message = await prisma.inboxMessage.findUnique({ where: { id: inbox }, include: { order: true } });
    if (message && !message.order) {
      inboxMessageId = message.id;
      inboxInfo = { subject: message.subject, fromEmail: message.fromEmail };
      initial.channel = message.source === "WEB_FORM" ? "WEB" : message.source === "EMAIL" ? "EMAIL" : "MANUAL";
      initial.note = message.subject ?? undefined;
      if (!initial.clientId && message.fromEmail) {
        const matched = await prisma.client.findFirst({ where: { email: message.fromEmail } });
        if (matched) initial.clientId = matched.id;
      }
    }
  }

  const newProduct = products.find((item) => item.id === produkt);

  return (
    <>
      <PageHeader title="Nová objednávka" subtitle="Vytvorenie objednávky s položkami" />
      {newProduct && (
        <p className="mb-4 max-w-3xl rounded-[10px] bg-green-50 px-4 py-3 text-sm text-green-900">
          Produkt {newProduct.name} je pridaný do novej objednávky. Vyberte klienta a skontrolujte cenu.
        </p>
      )}
      {inboxInfo && (
        <div className="mb-4 max-w-3xl rounded-[10px] bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Vytvárate objednávku zo správy v inboxe: <strong>{inboxInfo.subject ?? "(bez predmetu)"}</strong>
          {inboxInfo.fromEmail && <> od <strong>{inboxInfo.fromEmail}</strong></>}. Po uložení sa správa označí ako spracovaná.
        </div>
      )}
      <OrderForm
        action={createOrder}
        clients={clientsForForm}
        products={products}
        initial={initial}
        inboxMessageId={inboxMessageId}
        submitLabel="Vytvoriť objednávku"
        cancelHref={inboxMessageId ? "/objednavky/inbox" : "/objednavky"}
        draftKey="order:new"
        newProductId={newProduct?.id}
      />
    </>
  );
}
