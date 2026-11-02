"use client";

import { useActionState } from "react";
import { saveMaterial } from "./_actions";
import { btnSmallPrimary, errorBox, input, labelSmall } from "@/components/ui";

type Item = {
  id: string;
  name: string;
  unit: string;
  kind: string;
  minStock: number;
  targetStock: number | null;
  autoReorder: boolean;
  autoOrderLegalEntity: string | null;
};

export function MaterialForm({ item }: { item?: Item }) {
  const [state, action, pending] = useActionState(saveMaterial, {});
  return <form action={action} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
    {item && <input type="hidden" name="id" value={item.id} />}
    <div className="xl:col-span-2"><label className={labelSmall}>Názov</label><input name="name" required maxLength={255} defaultValue={item?.name} placeholder="Napr. sklenená fľaša 40 ml" className={input} /></div>
    <div><label className={labelSmall}>Druh</label><select name="kind" defaultValue={item?.kind ?? "INGREDIENT"} className={input}><option value="INGREDIENT">Surovina</option><option value="PACKAGING">Obal</option></select></div>
    <div><label className={labelSmall}>Jednotka</label><select name="unit" defaultValue={item?.unit ?? "ks"} disabled={!!item} className={input}><option value="ks">ks</option><option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option></select>{item && <input type="hidden" name="unit" value={item.unit} />}</div>
    <div><label className={labelSmall}>Objednať pod stavom</label><input name="minStock" required inputMode="decimal" defaultValue={item?.minStock ?? 0} className={input} /></div>
    <div><label className={labelSmall}>Doplniť na stav</label><input name="targetStock" inputMode="decimal" defaultValue={item?.targetStock ?? ""} placeholder="Voliteľné" className={input} /></div>
    {item && <label className="flex items-center gap-2 text-sm text-stone-800 sm:col-span-2 xl:col-span-4"><input type="checkbox" name="autoReorder" defaultChecked={item.autoReorder} /> Automaticky objednať obal e-mailom pri nízkom stave</label>}
    <div className="xl:col-span-2"><label className={labelSmall}>Nákupný subjekt</label><select name="autoOrderLegalEntity" defaultValue={item?.autoOrderLegalEntity ?? ""} className={input}><option value="">— vyberte pri automatike —</option><option value="SOLE_TRADER">Jakub Kuric – Zdravý shot</option><option value="KURGI">Kurgi s. r. o.</option></select></div>
    <div className="flex items-end xl:justify-end"><button disabled={pending} className={btnSmallPrimary}>{pending ? "Ukladám…" : item ? "Uložiť zmeny" : "Pridať položku"}</button></div>
    {state.error && <p className={`${errorBox} sm:col-span-2 xl:col-span-6`}>{state.error}</p>}
    {state.success && <p className="text-sm text-emerald-700 sm:col-span-2 xl:col-span-6">{state.success}</p>}
  </form>;
}
