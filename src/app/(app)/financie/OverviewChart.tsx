"use client";
import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/format";
import type { buildOverview } from "./overview-data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Máj", "Jún", "Júl", "Aug", "Sep", "Okt", "Nov", "Dec"];
export function OverviewChart({ data, year, entity }: { data: ReturnType<typeof buildOverview>; year: number; entity?: string }) {
  const [gross, setGross] = useState(true), [group, setGroup] = useState(1), [hovered, setHovered] = useState<number | null>(null);
  const points: { name: string; revenue: number; expenses: number }[] = [];
  for (let i = 0; i < 12; i += group) {
    const rows = data.months.slice(i, i + group);
    points.push({ name: group === 12 ? String(year) : group === 3 ? `${i / 3 + 1}. kvartál` : MONTHS[i], revenue: rows.reduce((s, m) => s + (gross ? m.revenueGross : m.revenueNet), 0), expenses: rows.reduce((s, m) => s + (gross ? m.expensesGross : m.expensesNet), 0) });
  }
  const revenue = points.reduce((s, p) => s + p.revenue, 0), expenses = points.reduce((s, p) => s + p.expenses, 0);
  const max = Math.max(100, ...points.flatMap(p => [Math.abs(p.revenue), Math.abs(p.expenses), Math.abs(p.revenue - p.expenses)]));
  const zeroY = 152, scale = 110 / max, width = Math.min(28, 220 / points.length);
  const x = (i: number) => 54 + (i + .5) * 660 / points.length;
  const href = (direction: string, unpaid = false) => `/financie/faktury?${new URLSearchParams({ smer: direction, rok: String(year), rozsah: "PREHLAD", ...(entity ? { subjekt: entity } : {}), ...(unpaid ? { uhrada: "UNPAID" } : {}) })}`;
  const focused = hovered === null ? null : points[hovered];
  return <div className="finance-report-body">
    <div className="finance-report-totals">
      <Link href={href("VYDANA")}><span>Fakturované</span><strong>{formatCents(revenue)}</strong></Link>
      <Link className="finance-muted-total" href={href("VYDANA", true)}><span>Neuhradené faktúry <small>s DPH</small></span><strong>{formatCents(data.unpaidRevenue)}</strong></Link>
      <Link href={href("PRIJATA")}><span>Evidované náklady</span><strong>{formatCents(expenses)}</strong></Link>
      <Link className="finance-muted-total" href={href("PRIJATA", true)}><span>Neuhradené náklady <small>s DPH</small></span><strong>{formatCents(data.unpaidExpenses)}</strong></Link>
      <div className="finance-balance"><span>Bilancia dokladov</span><strong>{formatCents(revenue - expenses)}</strong><small>{gross ? "Sumy s DPH" : "Sumy bez DPH"} · podľa dátumu vystavenia</small></div>
    </div>
    <div className="finance-chart-area">
      <div className="finance-chart-toolbar"><div className="finance-chart-legend"><span><i className="finance-dot-revenue" />Fakturované</span><span><i className="finance-dot-expenses" />Náklady</span><span><i className="finance-dot-balance" />Bilancia</span></div><label>Stĺpec: <select value={group} onChange={e => { setGroup(Number(e.target.value)); setHovered(null); }}><option value={1}>Mesiac</option><option value={3}>Kvartál</option><option value={12}>Rok</option></select></label></div>
      <svg viewBox="0 0 750 300" role="img" aria-label={`Fakturácia za rok ${year}. Fakturované ${formatCents(revenue)}, náklady ${formatCents(expenses)}.`} className="finance-chart">
        {[-1, -.5, 0, .5, 1].map(f => <g key={f}><line x1="54" y1={zeroY - f * 110} x2="724" y2={zeroY - f * 110} stroke={f === 0 ? "#aaa" : "#e7e5e4"} strokeDasharray={f === 0 ? undefined : "3 4"} /><text x="46" y={zeroY - f * 110 + 4} textAnchor="end" fontSize="10" fill="#78716c">{new Intl.NumberFormat("sk", { notation: "compact", maximumFractionDigits: 1 }).format(f * max / 100)}</text></g>)}
        {points.map((p, i) => <g key={p.name} tabIndex={0} aria-label={`${p.name}: fakturované ${formatCents(p.revenue)}, náklady ${formatCents(p.expenses)}`} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
          <rect x={x(i) - width - 3} y={zeroY - Math.max(0, p.revenue) * scale} width={width} height={Math.abs(p.revenue) * scale} fill="#ffd52e" rx="1" />
          <rect x={x(i) + 3} y={zeroY - Math.max(0, -p.expenses) * scale} width={width} height={Math.abs(p.expenses) * scale} fill="#353535" rx="1" />
          <text x={x(i)} y="285" textAnchor="middle" fontSize="10" fill="#57534e">{p.name}</text><title>{p.name}: {formatCents(p.revenue)} / {formatCents(p.expenses)}</title>
        </g>)}
        <polyline points={points.map((p, i) => `${x(i)},${zeroY - (p.revenue - p.expenses) * scale}`).join(" ")} fill="none" stroke="#a77500" strokeWidth="2.5" pointerEvents="none" />
        {points.map((p, i) => <circle key={p.name} cx={x(i)} cy={zeroY - (p.revenue - p.expenses) * scale} r={hovered === i ? 5 : 3} fill="#a77500" pointerEvents="none" />)}
      </svg>
      <div className="finance-chart-bottom"><p aria-live="polite">{focused ? `${focused.name}: ${formatCents(focused.revenue)} fakturované · ${formatCents(focused.expenses)} náklady` : data.documentCount === 0 ? "V tomto období zatiaľ nie sú evidované vystavené doklady." : "Pre podrobnosti vyberte mesiac v grafe."}</p><fieldset><legend className="sr-only">Zobrazenie DPH</legend><label><input type="radio" name="chart-vat" checked={!gross} onChange={() => setGross(false)} /> Bez DPH</label><label><input type="radio" name="chart-vat" checked={gross} onChange={() => setGross(true)} /> S DPH</label></fieldset></div>
    </div>
  </div>;
}
