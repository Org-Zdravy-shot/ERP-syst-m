import Link from "next/link";
import { formatCents } from "@/lib/format";

export const euro = (cents: number) => formatCents(cents);
export const skuLabels: Record<string, string> = { GINGER_60: "Zázvor 60 ml", GINGER_200: "Zázvor 200 ml", PINEAPPLE_60: "Ananás + škorica 60 ml", PINEAPPLE_200: "Ananás + škorica 200 ml" };
export function CampaignNav({ campaignId }: { campaignId: string }) {
  const links = [["", "Prehľad"], ["kalkulacie/nova", "Nová kalkulácia"], ["historia", "História"], ["nastavenia", "Náklady a cenník"], ["reklama", "Reklamné náklady"], ["vyuctovanie", "Vyúčtovanie agentúry"]];
  return <nav className="mb-6 flex flex-wrap gap-2">{links.map(([path, title]) => <Link key={path} href={`/vianocna-b2b/${path}${path ? `?kampan=${campaignId}` : `?kampan=${campaignId}`}`} className="rounded-[10px] border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:border-stone-400">{title}</Link>)}</nav>;
}
export function Stat({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return <div className={`rounded-[14px] border bg-white p-4 ${strong ? "border-emerald-400" : "border-stone-200"}`}><div className="text-xs text-stone-500">{label}</div><div className="mt-1 font-display text-xl font-bold tabular-nums">{value}</div>{hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}</div>;
}
