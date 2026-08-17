import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { OrderForm, type OrderFormInitial } from "../OrderForm";
import { createOrder } from "../_actions";

export default async function NovaObjednavkaPage({
  searchParams,
}: {
  searchParams: Promise<{ klient?: string; inbox?: string }>;
}) {
  const { klient, inbox } = await searchParams;

  const [clients, products] = await Promise.all([
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
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, priceB2bCents: true, priceB2cCents: true, vatRate: true },
      orderBy: { name: "asc" },
    }),
  ]);

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

  return (
    <>
      <PageHeader title="Nová objednávka" subtitle="Vytvorenie objednávky s položkami" />
      {inboxInfo && (
        <div className="mb-4 max-w-3xl rounded-[10px] bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Vytvárate objednávku zo správy v inboxe: <strong>{inboxInfo.subject ?? "(bez predmetu)"}</strong>
          {inboxInfo.fromEmail && <> od <strong>{inboxInfo.fromEmail}</strong></>}. Po uložení sa správa označí ako spracovaná.
        </div>
      )}
      <OrderForm
        action={createOrder}
        clients={clients}
        products={products}
        initial={initial}
        inboxMessageId={inboxMessageId}
        submitLabel="Vytvoriť objednávku"
        cancelHref={inboxMessageId ? "/objednavky/inbox" : "/objednavky"}
      />
    </>
  );
}
