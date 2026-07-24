import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { btnSecondary } from "@/components/ui";

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Historická migrácia"
        subtitle="ERP je jediný systém pre nové faktúry; staré systémy sú vyradené"
      >
        <Link href="/financie/nastavenia" className={btnSecondary}>
          Nastavenia financií
        </Link>
        <Link href="/financie/ekasa" className={btnSecondary}>
          eKasa import
        </Link>
        <Link href="/financie/faktury" className={btnSecondary}>
          ← Späť na faktúry
        </Link>
      </PageHeader>

      <div className="max-w-4xl space-y-5">
        <section className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-5 py-4">
          <h2 className="font-semibold text-emerald-950">Nové doklady vznikajú iba v ERP</h2>
          <p className="mt-1 text-sm text-emerald-900">
            CSV import zo SuperFaktúry je deaktivovaný. Faktúry vystavujte v ERP z objednávky alebo
            cez formulár novej faktúry; platby sa párujú v sekcii Banka.
          </p>
        </section>

        <section className="rounded-[14px] border border-stone-200 bg-white px-5 py-4">
          <h2 className="font-semibold text-stone-900">História z Omegy</h2>
          <p className="mt-1 text-sm text-stone-600">
            Jednorazová migrácia starých faktúr používa kontrolovaný Omega ZIP import so SHA-256,
            náhľadom, zálohou, auditom a ochranou pred duplicitami. Spúšťa ju iba administrátor
            počas účtovníckeho cutoveru; export sa neukladá do repozitára.
          </p>
        </section>

        <div className="rounded-[14px] border border-dashed border-stone-300 bg-white px-5 py-4 text-sm text-stone-500">
          <span className="font-medium text-stone-700">Web (e-shop):</span> objednávky prichádzajú
          automaticky cez <code className="rounded bg-stone-100 px-1">POST /api/inbox</code> a
          spracúvajú sa v sekcii Objednávky → Inbox.
        </div>
      </div>
    </>
  );
}
