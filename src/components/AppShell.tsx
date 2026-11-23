"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Sidebar } from "./Sidebar";

const sections = [
  { id: "overview", name: "Prehľady", href: "/financie" },
  { id: "invoices", name: "Faktúry", href: "/financie/faktury?smer=VYDANA" },
  { id: "quotes", name: "Cenové ponuky", href: "/financie/cenove-ponuky" },
  { id: "deliveries", name: "Dodacie listy", href: "/financie/dodacie-listy" },
  { id: "recurring", name: "Pravidelné", href: "/financie/pravidelne" },
  { id: "expenses", name: "Náklady", href: "/financie/faktury?smer=PRIJATA" },
  { id: "contacts", name: "Kontakty", href: "/klienti" },
  { id: "tools", name: "Nástroje", href: "/financie/nastroje" },
];

const companies = [
  { value: "", label: "Všetky subjekty" },
  { value: "KURGI", label: "Kurgi" },
  { value: "SOLE_TRADER", label: "Živnosť" },
  { value: "UNASSIGNED", label: "Nepriradené doklady" },
];

const overviewPages = [
  { href: "/financie", label: "Fakturácia" },
  { href: "/financie/cashflow", label: "Cash flow" },
  { href: "/financie/marze", label: "Marže a prevádzka" },
];

function withCompany(url: string, company: string) {
  if (!company) return url;
  return `${url}${url.includes("?") ? "&" : "?"}subjekt=${company}`;
}

function FinanceMenu({ label, children, primary = false }: {
  label: string;
  children: ReactNode;
  primary?: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  function close() {
    if (menu.current) menu.current.open = false;
  }
  function handleKey(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !menu.current?.open) return;
    close();
    menu.current.querySelector("summary")?.focus();
    event.stopPropagation();
  }
  return (
    <details
      ref={menu}
      name="finance-header-menu"
      className={primary ? "finance-menu finance-create-menu" : "finance-menu"}
      onKeyDown={handleKey}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) close();
      }}
    >
      <summary>{label}<span aria-hidden>⌄</span></summary>
      <div>{children}</div>
    </details>
  );
}

export function AppShell({
  children, userName, canViewFinance, canConfigureFinance, canCreateDraft, logoutAction,
}: {
  children: ReactNode;
  userName: string;
  canViewFinance: boolean;
  canConfigureFinance: boolean;
  canCreateDraft: boolean;
  logoutAction: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const isFinance = pathname === "/financie" || pathname.startsWith("/financie/");
  const isContact = pathname === "/klienti" || pathname.startsWith("/klienti/");
  if (!canViewFinance || (!isFinance && !isContact)) {
    return (
      <div className="flex min-h-screen flex-col bg-stone-50 md:flex-row">
        <Sidebar userName={userName} canViewFinance={canViewFinance} logoutAction={logoutAction} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">{children}</main>
      </div>
    );
  }

  const isInvoiceList = pathname === "/financie/faktury";
  const isOverview = overviewPages.some(({ href }) => href === pathname);
  const isExpense = pathname === "/financie/naklady"
    || (pathname.startsWith("/financie/faktury") && params.get("smer") === "PRIJATA");
  let section = "tools";
  if (isContact) section = "contacts";
  else if (isOverview) section = "overview";
  else if (isExpense) section = "expenses";
  else if (pathname.startsWith("/financie/cenove-ponuky")) section = "quotes";
  else if (pathname.startsWith("/financie/dodacie-listy")) section = "deliveries";
  else if (pathname.startsWith("/financie/pravidelne")) section = "recurring";
  else if (pathname.startsWith("/financie/faktury")) section = "invoices";

  const selectedCompany = companies.find(({ value }) => value === params.get("subjekt")) ?? companies[0];
  const canFilterCompany = isInvoiceList || pathname === "/financie" || pathname === "/financie/marze";
  function companyHref(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("subjekt", value);
    else next.delete("subjekt");
    return next.size ? `${pathname}?${next}` : pathname;
  }

  return (
    <div className="finance-workspace min-h-screen">
      <a href="#finance-content" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-brand focus:p-3">
        Preskočiť na obsah
      </a>
      <header key={`${pathname}?${params}`} className="finance-header print:hidden">
        <div className="finance-command-bar">
          <div className="finance-topbar">
            <Link href={withCompany("/financie", selectedCompany.value)} className="finance-brand">
              <span className="finance-brand-mark" aria-hidden>ZS</span>
              <span><strong>Fakturácia</strong><small>Zdravý Shot ERP</small></span>
            </Link>
            <form action={section === "quotes" ? "/financie/cenove-ponuky" : section === "deliveries" ? "/financie/dodacie-listy" : "/financie/faktury"} className="finance-global-search" role="search">
              {selectedCompany.value && <input name="subjekt" type="hidden" value={selectedCompany.value} />}
              <label className="sr-only" htmlFor="finance-global-search">{section === "deliveries" ? "Vyhľadať dodací list" : "Vyhľadať doklad podľa čísla, firmy alebo variabilného symbolu"}</label>
              <input id="finance-global-search" name="q" type="search" placeholder={section === "quotes" ? "Číslo ponuky alebo odberateľ" : section === "deliveries" ? "Dodací list, odberateľ alebo objednávka" : "Číslo dokladu, firma alebo VS"} maxLength={100} />
              <button type="submit">Hľadať</button>
            </form>
            <div className="finance-account-tools">
              <Link className="finance-erp-return" href="/">Späť do ERP</Link>
              <FinanceMenu label={userName}>
                {canConfigureFinance && <Link href="/financie/nastavenia">Nastavenia fakturácie</Link>}
                <Link href="/manual">Nápoveda</Link>
                <Link href="/">Späť do ERP</Link>
                <form action={logoutAction}><button type="submit">Odhlásiť sa</button></form>
              </FinanceMenu>
            </div>
          </div>
        </div>
        <div className="finance-nav-inner">
          <nav aria-label="Fakturácia" className="finance-primary-nav">
            {sections.map((tab) => (
              <Link key={tab.id} href={withCompany(tab.href, selectedCompany.value)} aria-current={section === tab.id ? "page" : undefined}>
                {tab.name}
              </Link>
            ))}
          </nav>
          <div className="finance-nav-actions">
            {canFilterCompany && (
              <FinanceMenu label={selectedCompany.label}>
                {companies.map(({ value, label }) => (
                  <Link key={value} href={companyHref(value)} aria-current={value === selectedCompany.value ? "true" : undefined}>
                    {label}
                  </Link>
                ))}
              </FinanceMenu>
            )}
            {canCreateDraft && (
              <FinanceMenu label="+ Vytvoriť nový" primary>
                <Link href={withCompany("/financie/faktury/nova", selectedCompany.value)}>Faktúra</Link>
                <Link href={withCompany("/financie/faktury/suhrnna", selectedCompany.value)}>Súhrnná faktúra</Link>
                <Link href={withCompany("/financie/dodacie-listy/novy", selectedCompany.value)}>Dodací list</Link>
                <Link href={withCompany("/financie/cenove-ponuky/novy", selectedCompany.value)}>Cenová ponuka</Link>
                <Link href="/financie/faktury/historicka">Historický doklad</Link>
                <Link href="/klienti/novy">Kontakt</Link>
                <Link href="/objednavky/nova">Objednávka</Link>
              </FinanceMenu>
            )}
          </div>
        </div>
      </header>
      <main id="finance-content" tabIndex={-1} className="finance-content">
        {isOverview && (
          <nav className="finance-subnav print:hidden" aria-label="Druhy prehľadov">
            {overviewPages.map(({ href, label }) => (
              <Link key={href} href={withCompany(href, selectedCompany.value)} aria-current={pathname === href ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}
