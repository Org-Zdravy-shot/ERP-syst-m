"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  prehlad: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  vyroba: (
    <>
      <path d="M9 3h6M10 3v5.5L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 8.5V3" />
      <path d="M7.5 14h9" />
    </>
  ),
  sklad: (
    <>
      <path d="M3 8l9-5 9 5-9 5-9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  dodavatelia: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
      <path d="m8 5 9 4.5v4" />
    </>
  ),
  objednavky: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.6L21 8H6" />
    </>
  ),
  produkty: (
    <>
      <path d="M3 8l9-5 9 5-9 5-9-5Z" />
      <path d="M3 8v8l9 5 9-5V8M12 13v8" />
    </>
  ),
  plan: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  financie: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.5 9.7c0-1.2 1.1-2 2.5-2s2.5.9 2.5 2c0 2.6-5 1.8-5 4.4 0 1.1 1.1 2 2.5 2s2.5-.8 2.5-2" />
    </>
  ),
  vianoce: (
    <>
      <rect x="5" y="9" width="14" height="12" rx="1" />
      <path d="M3 9h18M12 9v12M12 9c-3-2-5-3-5-5 0-1.5 1-2 2-2 2 0 3 4 3 7ZM12 9c3-2 5-3 5-5 0-1.5-1-2-2-2-2 0-3 4-3 7Z" />
    </>
  ),
  klienti: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <circle cx="17.5" cy="9" r="2.3" />
      <path d="M15.3 14.7c2.3.3 4.2 2.2 4.2 5.3" />
    </>
  ),
  konkurencia: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.7-4.7" />
    </>
  ),
  manual: (
    <>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" />
      <path d="M5 19a2 2 0 0 1 2-2h13M9 6h7M9 10h7" />
    </>
  ),
};

const NAV_ITEMS = [
  { href: "/", label: "Prehľad", icon: "prehlad" },
  { href: "/vyroba", label: "Výroba", icon: "vyroba" },
  { href: "/sklad", label: "Sklad", icon: "sklad" },
  { href: "/dodavatelia", label: "Dodávatelia", icon: "dodavatelia" },
  { href: "/objednavky", label: "Objednávky", icon: "objednavky" },
  { href: "/produkty", label: "Produkty", icon: "produkty" },
  { href: "/plan", label: "Plnenie plánu", icon: "plan" },
  { href: "/financie", label: "Financie", icon: "financie" },
  { href: "/vianocna-b2b", label: "Vianočná B2B kampaň", icon: "vianoce" },
  { href: "/klienti", label: "Klienti", icon: "klienti" },
  { href: "/konkurencia", label: "Konkurencia", icon: "konkurencia" },
  { href: "/manual", label: "Manuál", icon: "manual" },
];

export function Sidebar({
  userName,
  canViewFinance,
  logoutAction,
}: {
  userName: string;
  canViewFinance: boolean;
  logoutAction: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex w-full shrink-0 flex-col bg-stone-950 md:w-60 print:hidden">
      <div className="px-4 pb-1 pt-3 md:px-5 md:pt-[22px]">
        <Image
          src="/logo.png"
          alt="Zdravý Shot"
          width={120}
          height={28}
          className="block h-7 w-auto invert"
          priority
        />
        <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-stone-500">
          ERP systém
        </div>
      </div>

      <nav className="flex flex-1 flex-row gap-0.5 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:px-3 md:pt-5">
        {NAV_ITEMS.filter(
          (item) =>
            (item.href !== "/financie" && item.href !== "/manual" && item.href !== "/plan" && item.href !== "/vianocna-b2b") ||
            canViewFinance,
        ).map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-[11px] rounded-[10px] px-3 py-[9px] text-[13.5px] transition ${
                isActive
                  ? "bg-brand font-semibold text-stone-950"
                  : "font-medium text-stone-300 hover:bg-stone-900 hover:text-white"
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[item.icon]}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-stone-800 px-4 py-2 md:mt-3 md:block md:px-5 md:py-4">
        <div className="text-xs text-stone-400 md:mb-2">{userName}</div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-xs text-stone-500 underline-offset-2 transition hover:text-white hover:underline"
          >
            Odhlásiť sa
          </button>
        </form>
      </div>
    </aside>
  );
}
