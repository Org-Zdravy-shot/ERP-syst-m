import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { PageHeader } from "@/components/PageHeader";

export default async function FinanceToolsPage() {
  const user = await requireUser();
  const tools = [
    ["Banka a platby", "Import bankových výpisov, transakcie a párovanie úhrad.", "/financie/banka", "↔"],
    ["Párovanie úhrad", "Priraďte evidované platby ku konkrétnym faktúram.", "/financie/banka/parovanie", "✓"],
    ["Historická migrácia", "Postup prenosu starších dokladov z Omegy.", "/financie/import", "↓"],
    ["Export pre účtovníka", "Stiahnite finalizované doklady v účtovnom CSV exporte.", "/financie/export", "↑"],
    ["eKasa", "Predaje z pokladne a ich väzby na faktúry.", "/financie/ekasa", "▣"],
    ["Marže a prevádzka", "Podrobný prehľad eKasy, platieb a marží produktov.", "/financie/marze", "%"],
    ...(hasFinancePermission(user.role, "CONFIGURE") ? [["Nastavenia", "Firemné údaje, bankové účty, číslovanie a daňové profily.", "/financie/nastavenia", "⚙"]] : []),
  ];
  return (
    <>
      <PageHeader title="Nástroje" />
      <div className="finance-tools-grid">
        {tools.map(([title, detail, href, icon]) => (
          <Link key={href} href={href} className="finance-tool" download={href === "/financie/export" || undefined}>
            <span aria-hidden>{icon}</span>
            <div><h2>{title}</h2><p>{detail}</p></div>
            <b aria-hidden>→</b>
          </Link>
        ))}
      </div>
    </>
  );
}
