import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { card } from "@/components/ui";
import { requireFinancePermission } from "@/lib/finance/permissions";

function flagState(name: string, enabledValues: string[] = ["1", "true"]) {
  const value = process.env[name]?.trim().toLowerCase();
  return value && enabledValues.includes(value)
    ? { label: "Zapnuté", color: "emerald" as const }
    : { label: "Vypnuté", color: "gray" as const };
}

function configuredState(name: string) {
  return process.env[name]?.trim()
    ? { label: "Nastavené", color: "emerald" as const }
    : { label: "Chýba", color: "yellow" as const };
}

const externalFlags = [
  ["Produkčné vystavovanie", "FINANCE_PRODUCTION_ISSUING_ENABLED"],
  ["eFaktúra sandbox", "EINVOICE_ENABLED"],
  ["eFaktúra produkcia", "EINVOICE_LIVE_ENABLED"],
  ["Tatra Premium API", "TATRA_PREMIUM_ENABLED"],
  ["Potvrdené e-mailové DKIM", "FINANCE_MAIL_DKIM_CONFIRMED"],
] as const;

const sandboxVariables = [
  "EFAKTURA_API_BASE",
  "EFAKTURA_API_KEY",
  "EFAKTURA_ORGANIZATION_ID",
  "EFAKTURA_WEBHOOK_SECRET",
] as const;

export default async function ManualPage() {
  await requireFinancePermission("VIEW");

  return (
    <>
      <PageHeader
        title="Manuál a pokračovanie"
        subtitle="Odovzdávací bod projektu · aktualizované 12. septembra 2026"
      />

      <section className="mb-6 rounded-[14px] border border-amber-200 bg-amber-50 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="yellow">Aktuálne čaká</Badge>
          <h2 className="font-semibold text-amber-950">
            eFaktúra sandbox onboarding ešte nebol urobený
          </h2>
        </div>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-amber-900">
          Prvý krok po návrate je dokončiť GitHub issue #44. Až keď budú
          testovacie údaje vložené priamo v Railway Variables, napíš vývojárovi
          iba „sandbox hotovo“. Kľúče nikdy neposielaj do chatu ani GitHubu.
        </p>
        <a
          href="https://github.com/Org-Zdravy-shot/ERP-syst-m/issues/44"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block rounded-[10px] bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800"
        >
          Otvoriť postup v issue #44 ↗
        </a>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className={`${card} p-5`}>
          <h2 className="font-semibold text-stone-950">Kde sme skončili</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-600">
            <li>• Dodávateľský modul S0–S2 je hotový; S3 je budúca automatizácia.</li>
            <li>• eFaktúra PR #40–#49 sú zmergované.</li>
            <li>• Hotový je klient, UBL, recipient lookup, HMAC webhook, archív a validačný panel.</li>
            <li>• Posledná kontrola: 48 testovacích súborov, 210 testov, typecheck a build.</li>
            <li>• Overené nasadenie: <code>126d9b63-6568-4a96-85e5-530474586dd7</code>.</li>
          </ul>
        </section>

        <section className={`${card} p-5`}>
          <h2 className="font-semibold text-stone-950">Živé bezpečnostné brány</h2>
          <p className="mt-1 text-xs text-stone-500">
            Číta sa iba zapnuté/vypnuté; žiadna tajná hodnota sa nezobrazuje.
          </p>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {externalFlags.map(([label, name]) => {
              const state = flagState(name);
              return (
                <li key={name} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-stone-700">{label}</span>
                  <Badge color={state.color}>{state.label}</Badge>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${card} p-5`}>
          <h2 className="font-semibold text-stone-950">eFaktúra sandbox údaje</h2>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {sandboxVariables.map((name) => {
              const state = configuredState(name);
              return (
                <li key={name} className="flex items-center justify-between gap-3 py-2">
                  <code className="text-xs text-stone-700">{name}</code>
                  <Badge color={state.color}>{state.label}</Badge>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${card} p-5`}>
          <h2 className="font-semibold text-stone-950">Čo urobíme po „sandbox hotovo“</h2>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-stone-600">
            <li>1. Overíme prítomnosť premenných a testovací prefix bez zobrazenia kľúča.</li>
            <li>2. Zapneme iba sandbox; live aj produkčné vystavovanie ostanú vypnuté.</li>
            <li>3. Otestujeme recipient lookup, nemenné UBL a <code>validateOnly</code>.</li>
            <li>4. Otestujeme HMAC webhook, deduplikáciu a replay.</li>
            <li>5. Potom dokončíme sandbox outbox, príjem dokladov a E2E.</li>
          </ol>
        </section>
      </div>

      <section className={`${card} mt-6 p-5`}>
        <h2 className="font-semibold text-stone-950">Ďalšie otvorené bloky</h2>
        <div className="mt-3 grid gap-4 text-sm leading-6 text-stone-600 md:grid-cols-3">
          <div>
            <h3 className="font-semibold text-stone-800">DPH</h3>
            <p>Účtovník musí písomne potvrdiť dátum registrácie, KN zatriedenie a sadzbu každého produktu. Október a 23 % nie sú potvrdené.</p>
          </div>
          <div>
            <h3 className="font-semibold text-stone-800">E-mail</h3>
            <p>
              Resend, DNS a DKIM/SPF/DMARC test ostáva odložený v{" "}
              <a className="underline" href="https://github.com/Org-Zdravy-shot/ERP-syst-m/issues/29" target="_blank" rel="noreferrer">issue #29</a>.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-stone-800">Tatra banka</h3>
            <p>Premium API potrebuje onboarding, consent, tokeny a sandbox. Dovtedy zostáva vypnuté a používa sa import výpisu.</p>
          </div>
        </div>
      </section>

      <p className="mt-5 text-xs text-stone-500">
        Plný verzovaný handoff je v{" "}
        <a
          className="underline"
          href="https://github.com/Org-Zdravy-shot/ERP-syst-m/blob/main/docs/PROJECT_HANDOFF.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/PROJECT_HANDOFF.md
        </a>
        . Návrat do financií: <Link href="/financie" className="underline">Financie</Link>.
      </p>
    </>
  );
}
