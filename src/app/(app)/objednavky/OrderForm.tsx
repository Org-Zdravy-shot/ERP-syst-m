"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/format";
import { lineNetCents, parseUnitPrice } from "@/lib/precise-price";
import { orderChannelLabels } from "@/lib/zod-schemas";
import type { OrderFormState } from "./_actions";
import { resolvePriceWithSource, slovakDateKey, type ClientPriceRuleInput } from "./pricing";
import { repriceDraftRows, restoreOrderDraft, storedOrderPriceInput } from "./draft";

export interface OrderFormClient {
  id: string;
  name: string;
  type: string;
  productPrices: Array<{ productId: string; unitPriceCents: number }>;
  priceRules: ClientPriceRuleInput[];
}
export interface OrderFormProduct {
  id: string;
  name: string;
  sku: string;
  priceB2bCents: number | null;
  priceB2cCents: number;
  vatRate: number;
}
type PriceSource = "CLIENT" | "B2B" | "B2C" | "MANUAL";
interface ItemRow {
  productId: string;
  quantity: string;
  priceEur: string;
  vatRate: number;
  priceSource: PriceSource;
  minimumExpiryDate: string;
  manual?: boolean;
}
export interface OrderFormInitial {
  clientId?: string;
  channel?: string;
  deliveryDate?: string;
  latestDeliveryDate?: string;
  deliveryStreet?: string;
  deliveryCity?: string;
  deliveryZip?: string;
  deliveryCountry?: string;
  deliveryContact?: string;
  paymentMethod?: string;
  paymentTermDays?: number | null;
  note?: string;
  items?: Array<{ productId: string; quantity: number; unitPriceCents: number; unitPriceExact?: string | { toString(): string } | null; vatRate: number; priceSource?: string | null; minimumExpiryDate?: string | Date | null }>;
}
interface Draft {
  clientId: string; channel: string; deliveryDate: string; latestDeliveryDate: string;
  deliveryStreet: string; deliveryCity: string; deliveryZip: string; deliveryCountry: string;
  deliveryContact: string; paymentMethod: string; paymentTermDays: string; note: string;
  rows: ItemRow[]; submissionKey: string;
}
const blankRow = (): ItemRow => ({ productId: "", quantity: "1", priceEur: "", vatRate: 20, priceSource: "MANUAL", minimumExpiryDate: "", manual: false });
const inputClass = "w-full rounded-[10px] border border-stone-300 px-3 py-2 text-sm focus:border-stone-950 focus:outline-none focus:ring-[3px] focus:ring-brand/35";
const labelClass = "mb-1 block text-sm font-medium text-stone-700";
const sourceLabels: Record<PriceSource, string> = { CLIENT: "Cenník klienta", B2B: "Základná B2B cena", B2C: "Katalógová B2C cena", MANUAL: "Ručná cena iba pre túto objednávku" };
const paymentLabels: Record<string, string> = { UNKNOWN: "Nezaznamenané (staršia objednávka)", UNAGREED: "Nedohodnuté", INVOICE: "Faktúra", CARD_ON_DELIVERY: "Karta pri dodaní", BANK_TRANSFER: "Bankový prevod", CASH: "Hotovosť" };
const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const dateInput = (value: Date | string | null | undefined) => value ? (typeof value === "string" ? value : value.toISOString()).slice(0, 10) : "";

export function OrderForm({ action, clients, products, initial, inboxMessageId, submitLabel, cancelHref, draftKey, newProductId }: {
  action: (prevState: OrderFormState, formData: FormData) => Promise<OrderFormState>;
  clients: OrderFormClient[]; products: OrderFormProduct[]; initial?: OrderFormInitial;
  inboxMessageId?: string; submitLabel: string; cancelHref: string; draftKey: string; newProductId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [draft, setDraft] = useState<Draft>(() => ({
    clientId: initial?.clientId ?? "", channel: initial?.channel ?? "MANUAL",
    deliveryDate: initial?.deliveryDate ?? "", latestDeliveryDate: initial?.latestDeliveryDate ?? "",
    deliveryStreet: initial?.deliveryStreet ?? "", deliveryCity: initial?.deliveryCity ?? "",
    deliveryZip: initial?.deliveryZip ?? "", deliveryCountry: initial?.deliveryCountry ?? "",
    deliveryContact: initial?.deliveryContact ?? "", paymentMethod: initial?.paymentMethod ?? "UNAGREED",
    paymentTermDays: initial?.paymentTermDays == null ? "" : String(initial.paymentTermDays), note: initial?.note ?? "",
    rows: initial?.items?.length ? initial.items.map((item) => ({
      productId: item.productId, quantity: String(item.quantity),
      priceEur: storedOrderPriceInput(item),
      vatRate: item.vatRate, priceSource: (item.priceSource as PriceSource) ?? "MANUAL",
      minimumExpiryDate: dateInput(item.minimumExpiryDate),
      manual: item.priceSource === "MANUAL" || !item.priceSource,
    })) : [blankRow()], submissionKey: "",
  }));
  const [ready, setReady] = useState(false);
  const [review, setReview] = useState(false);
  const submitted = useRef(false);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;

  useEffect(() => {
    const validProductId = newProductId && products.some((product) => product.id === newProductId) ? newProductId : undefined;
    let restored = restoreOrderDraft(draft, localStorage.getItem(draftKey), validProductId, (productId, sourceDraft): ItemRow => {
      const product = products.find((candidate) => candidate.id === productId)!;
      const client = clients.find((candidate) => candidate.id === sourceDraft.clientId);
      const price = client ? resolvePriceWithSource(client.type, product, client.productPrices, client.priceRules, sourceDraft.deliveryDate || slovakDateKey()) : null;
      return { ...blankRow(), productId, vatRate: product.vatRate,
        priceEur: price?.cents == null ? "" : centsToInput(price.cents), priceSource: price?.source ?? "MANUAL" };
    });
    if (!restored.submissionKey) restored = { ...restored, submissionKey: crypto.randomUUID() };
    setDraft(restored);
    setReady(true);
    // Hydrate only once per form mount; navigation to product remounts with its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(draftKey, JSON.stringify(draft)); }, [draft, ready, draftKey]);
  useEffect(() => { if (state.error) submitted.current = false; }, [state]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (ready && !submitted.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [ready]);

  const setField = (field: keyof Draft, value: string) => { setDraft((old) => ({ ...old, [field]: value })); setReview(false); };
  const setRows = (fn: (rows: ItemRow[]) => ItemRow[]) => { setDraft((old) => ({ ...old, rows: fn(old.rows) })); setReview(false); };
  const updateRow = (index: number, patch: Partial<ItemRow>) => setRows((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const resolve = (clientId: string, productId: string, date: string) => {
    const client = clients.find((candidate) => candidate.id === clientId);
    const product = products.find((candidate) => candidate.id === productId);
    return client && product ? resolvePriceWithSource(client.type, product, client.productPrices, client.priceRules, date || slovakDateKey()) : null;
  };
  const reprice = (clientId: string, date: string) => setDraft((old) => ({ ...old, clientId, deliveryDate: date,
    rows: repriceDraftRows(old.rows, (productId) => {
      const price = resolve(clientId, productId, date);
      return price ? { priceEur: price.cents == null ? "" : centsToInput(price.cents), priceSource: price.source } : null;
    }),
  }));
  const changeProduct = (index: number, productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    const price = resolve(draft.clientId, productId, draft.deliveryDate);
    updateRow(index, { productId, vatRate: product?.vatRate ?? 20,
      priceEur: price?.cents == null ? "" : centsToInput(price.cents), priceSource: price?.source ?? "MANUAL", manual: false });
  };
  const line = (row: ItemRow) => {
    try {
      const quantity = Number(row.quantity);
      if (!row.productId || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
      const exact = parseUnitPrice(row.priceEur);
      const net = lineNetCents(quantity, exact);
      return { net, vat: Math.floor((net * row.vatRate + 50) / 100), exact };
    } catch { return null; }
  };
  const errors = draft.rows.map((row) => {
    if (!row.productId) return "Vyberte produkt.";
    if (!Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) <= 0) return "Zadajte kladné celé množstvo.";
    try { parseUnitPrice(row.priceEur); return ""; } catch (error) { return error instanceof Error ? error.message : "Neplatná cena."; }
  });
  const totals = draft.rows.reduce((sum, row) => { const value = line(row); return value ? { net: sum.net + value.net, vat: sum.vat + value.vat } : sum; }, { net: 0, vat: 0 });
  const itemsJson = JSON.stringify(draft.rows.map((row) => ({
    productId: row.productId, quantity: Number(row.quantity), unitPriceExact: row.priceEur,
    vatRate: row.vatRate, priceSource: row.priceSource, minimumExpiryDate: row.minimumExpiryDate || undefined,
  })));
  const productParams = new URLSearchParams({ zObjednavky: "1" });
  if (draft.clientId) productParams.set("klient", draft.clientId);
  if (inboxMessageId) productParams.set("inbox", inboxMessageId);
  const canReview = draft.clientId && errors.every((error) => !error) && draft.rows.length > 0;

  return <form action={formAction} onSubmit={(event) => {
    if (!review || !canReview) { event.preventDefault(); setReview(true); return; }
    if (submitted.current) { event.preventDefault(); return; }
    submitted.current = true;
  }} className="max-w-4xl space-y-5 rounded-[14px] border border-stone-200 bg-white p-6">
    <input type="hidden" name="items" value={itemsJson} />
    <input type="hidden" name="submissionKey" value={draft.submissionKey} />
    {inboxMessageId && <input type="hidden" name="inboxMessageId" value={inboxMessageId} />}
    <div className="flex items-center justify-between gap-3 text-xs text-stone-500"><span>Rozpracovaný formulár sa priebežne ukladá v tomto prehliadači. Pri zmene klienta alebo dátumu sa obnovia iba ceny z cenníka; ručné ceny zostanú.</span><button type="button" className="shrink-0 text-red-700 underline" onClick={() => { if (window.confirm("Zahodiť rozpracovaný koncept objednávky?")) { submitted.current = true; localStorage.removeItem(draftKey); window.location.reload(); } }}>Zahodiť koncept</button></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="sm:col-span-2"><label htmlFor="clientId" className={labelClass}>Klient *</label>
        <select id="clientId" name="clientId" required value={draft.clientId} onChange={(e) => reprice(e.target.value, draft.deliveryDate)} className={inputClass}>
          <option value="">— vyberte klienta —</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.type})</option>)}
        </select></div>
      <div><label htmlFor="channel" className={labelClass}>Kanál</label><select id="channel" name="channel" value={draft.channel} onChange={(e) => setField("channel", e.target.value)} className={inputClass}>{Object.entries(orderChannelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div><label htmlFor="deliveryDate" className={labelClass}>Preferovaný dátum dodania</label><input id="deliveryDate" name="deliveryDate" type="date" value={draft.deliveryDate} onChange={(e) => reprice(draft.clientId, e.target.value)} className={inputClass} /></div>
      <div><label htmlFor="latestDeliveryDate" className={labelClass}>Najneskorší termín dodania</label><input id="latestDeliveryDate" name="latestDeliveryDate" type="date" min={draft.deliveryDate || undefined} value={draft.latestDeliveryDate} onChange={(e) => setField("latestDeliveryDate", e.target.value)} className={inputClass} /></div>
    </div>
    <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Dodanie (ak sa líši od fakturačnej adresy)</legend>
      {([ ["deliveryStreet", "Ulica a číslo"], ["deliveryCity", "Mesto"], ["deliveryZip", "PSČ"], ["deliveryCountry", "Krajina"], ["deliveryContact", "Kontaktná osoba pri dodaní"] ] as const).map(([field, label]) =>
        <div key={field}><label htmlFor={field} className={labelClass}>{label}</label><input id={field} name={field} value={draft[field]} onChange={(e) => setField(field, e.target.value)} className={inputClass} /></div>) }
    </fieldset>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div><label htmlFor="paymentMethod" className={labelClass}>Spôsob úhrady</label><select id="paymentMethod" name="paymentMethod" value={draft.paymentMethod} onChange={(e) => setField("paymentMethod", e.target.value)} className={inputClass}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label htmlFor="paymentTermDays" className={labelClass}>Splatnosť faktúry (dni)</label><input id="paymentTermDays" name="paymentTermDays" type="number" min="0" max="365" step="1" value={draft.paymentTermDays} onChange={(e) => setField("paymentTermDays", e.target.value)} placeholder="Predvolene 14" className={inputClass} /></div>
      <div><label htmlFor="note" className={labelClass}>Poznámka</label><input id="note" name="note" value={draft.note} onChange={(e) => setField("note", e.target.value)} className={inputClass} /></div>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-stone-700">Položky *</span><div className="flex gap-2"><Link href={`/produkty/nova?${productParams.toString()}`} onClick={() => localStorage.setItem(draftKey, JSON.stringify(currentDraft.current))} className="rounded-[10px] border border-stone-300 px-3 py-1 text-sm">+ Nový produkt</Link><button type="button" onClick={() => setRows((rows) => [...rows, blankRow()])} className="rounded-[10px] border border-stone-300 px-3 py-1 text-sm">+ Položka</button></div></div>
      <div className="space-y-3">{draft.rows.map((row, index) => { const result = line(row); return <div key={index} className="grid grid-cols-1 gap-2 rounded-[10px] border border-stone-200 p-3 sm:grid-cols-12">
        <div className="sm:col-span-4"><label className={labelClass}>Produkt</label><select value={row.productId} onChange={(e) => changeProduct(index, e.target.value)} className={inputClass}><option value="">— vyberte produkt —</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}</select></div>
        <div className="sm:col-span-2"><label className={labelClass}>Množstvo</label><input type="number" min="1" step="1" value={row.quantity} onChange={(e) => updateRow(index, { quantity: e.target.value })} className={inputClass} /></div>
        <div className="sm:col-span-3"><label className={labelClass}>Cena/ks bez DPH (€)</label><input inputMode="decimal" value={row.priceEur} onChange={(e) => updateRow(index, { priceEur: e.target.value, priceSource: "MANUAL", manual: true })} placeholder="1,827" aria-invalid={!!errors[index]} className={inputClass} /><p className="mt-1 text-xs text-stone-500">{sourceLabels[row.priceSource]}</p>{errors[index] && <p className="mt-1 text-xs text-red-700" role="alert">{errors[index]}</p>}{state.priceErrorIndex === index && state.error && <p className="mt-1 text-xs text-red-700" role="alert">{state.error}</p>}</div>
        <div className="sm:col-span-1"><label className={labelClass}>DPH %</label><input type="number" min="0" max="100" step="1" value={row.vatRate} onChange={(e) => updateRow(index, { vatRate: Number(e.target.value) })} className={inputClass} /></div>
        <div className="sm:col-span-2 text-right"><span className={labelClass}>Základ</span><strong>{result ? formatCents(result.net) : "—"}</strong><button type="button" onClick={() => setRows((rows) => rows.filter((_, i) => i !== index))} disabled={draft.rows.length === 1} className="mt-1 block w-full text-xs text-red-700 disabled:opacity-30">Odstrániť</button></div>
        <div className="sm:col-span-5"><label className={labelClass}>Požadovaná minimálna exspirácia pri dodaní</label><input type="date" value={row.minimumExpiryDate} onChange={(e) => updateRow(index, { minimumExpiryDate: e.target.value })} className={inputClass} /></div>
        {row.manual && row.productId && <button type="button" className="self-end text-left text-xs text-stone-700 underline sm:col-span-4" onClick={() => { const price = resolve(draft.clientId, row.productId, draft.deliveryDate); if (price) updateRow(index, { priceEur: price.cents == null ? "" : centsToInput(price.cents), priceSource: price.source, manual: false }); }}>Obnoviť cenu z cenníka</button>}
      </div>; })}</div>
      <dl className="mt-3 ml-auto w-64 space-y-1 text-sm"><div className="flex justify-between"><dt>Spolu bez DPH</dt><dd>{formatCents(totals.net)}</dd></div><div className="flex justify-between"><dt>DPH</dt><dd>{formatCents(totals.vat)}</dd></div><div className="flex justify-between border-t pt-1 font-semibold"><dt>Spolu s DPH</dt><dd>{formatCents(totals.net + totals.vat)}</dd></div></dl>
    </div>
    {review && <section className="rounded-[10px] border border-amber-300 bg-amber-50 p-4 text-sm"><h2 className="font-semibold">Kontrola pred uložením</h2><p>Klient: {clients.find((client) => client.id === draft.clientId)?.name ?? "Nevybraný"} · Kanál: {orderChannelLabels[draft.channel as keyof typeof orderChannelLabels] ?? draft.channel}</p>
      {draft.rows.map((row, index) => <p key={index}>{products.find((product) => product.id === row.productId)?.name ?? "Nevybraný produkt"} · {row.quantity} ks × {row.priceEur} € bez DPH · DPH {row.vatRate} % · {sourceLabels[row.priceSource]} · základ {formatCents(line(row)?.net ?? 0)}{row.minimumExpiryDate && ` · min. exspirácia ${row.minimumExpiryDate}`}</p>)}
      <p>Preferované dodanie: {draft.deliveryDate || "—"} · najneskôr: {draft.latestDeliveryDate || "—"} · kontakt: {draft.deliveryContact || "—"}</p><p>Dodacia adresa: {[draft.deliveryStreet, draft.deliveryZip, draft.deliveryCity, draft.deliveryCountry].filter(Boolean).join(", ") || "Fakturačná adresa"}</p><p>Úhrada: {paymentLabels[draft.paymentMethod]} · splatnosť: {draft.paymentTermDays === "" ? "14" : draft.paymentTermDays} dní · poznámka: {draft.note || "—"}</p><p className="mt-2 font-semibold">Základ {formatCents(totals.net)} · DPH {formatCents(totals.vat)} · spolu {formatCents(totals.net + totals.vat)}</p></section>}
    {state.error && state.priceErrorIndex === undefined && <p role="alert" className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
    <div className="flex gap-3"><button type="submit" disabled={pending || !ready || !canReview} className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50">{pending ? "Ukladám…" : review ? submitLabel : "Skontrolovať objednávku"}</button><Link href={cancelHref} className="rounded-[10px] border border-stone-300 px-4 py-2 text-sm">Späť</Link></div>
  </form>;
}
