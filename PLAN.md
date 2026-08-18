# ERP Zdravý shot — plán a rozdelenie práce (2 vývojári)

Interný ERP pre Zdravý shot. Na projekte pracujú **dvaja ľudia paralelne, každý so svojím Claude Code**, koordinácia cez GitHub (`main` + feature branchy + PR).

> **Aktívna iniciatíva:** pokračovanie projektu pre troch developerov a náhrada
> SuperFaktúry/Omegy je rozpísaná v
> [`docs/FINANCE_V2_IMPLEMENTATION_PLAN.md`](docs/FINANCE_V2_IMPLEMENTATION_PLAN.md).
> Tento dokument nižšie zostáva historickým plánom pôvodnej v1.
>
> **Aktívny modul dodávateľov:** dátový model, používateľské profily, vratné
> obaly, nákupné objednávky a doobjednávanie sú rozpísané v
> [`docs/SUPPLIER_MODULE_PLAN.md`](docs/SUPPLIER_MODULE_PLAN.md).

## Stav

- [x] **Fáza 0 — spoločný základ** (hotová, je v `main`): scaffold Next.js 16 + Prisma 6 (SQLite) + kompletná schéma + migrácia + seed, iron-session auth, layout so slovenským sidebarom, placeholder stránky všetkých modulov, `POST /api/inbox`, `GET /api/konkurencia` stub, zdieľané helpery v `src/lib/`
- [x] **Dev A — Prevádzka** (hotová, je v `main`): Sklad (stavy z ledgeru, pohyby, príjem/výdaj), Výroba (receptúry, šarže, transakčné dokončenie s odpisom surovín), Plnenie plánu (ciele vs. live skutočnosť), Dashboard (živé KPI)
- [x] **Dev B — Obchod a financie** (hotová, je v `main`): Klienti + Objednávky + Predplatné + Inbox (Dev B), Financie — faktúry (vystavenie z objednávky, ručné, stavy, tlač), SuperFaktúra CSV import, eKasa import, CSV export pre účtovníka, marže (dokončil Dev A vo feat/financie)

## Moduly a vstupy

Dashboard · Výroba · Sklad · Objednávky · Plnenie plánu · Financie · Klienti · Konkurencia (neskôr).
Faktúry prichádzajú z **webu (e-shop)** a zo **SuperFaktúry** → zjednocujú sa do jednej tabuľky `Invoice` s interným číslom (`FA2026001`) prideľovaným vždy, `@@unique([source, externalId])` robí import idempotentným. E-mailové vstupy sa doriešia neskôr (tabuľka `InboxMessage` + `POST /api/inbox` sú pripravené).

## Rozdelenie práce

### Dev A — „Prevádzka“

| Branch | Obsah |
|---|---|
| `feat/sklad` | Stavy zásob z ledgeru (`src/lib/stock.ts` už existuje), formuláre príjem/výdaj, zoznam pohybov, low-stock zvýraznenie |
| `feat/vyroba` | Receptúry (zoznam + editor), šarže, akcia **„Dokončiť šaržu“** = 1 transakcia: −SPOTREBA podľa receptúry škálovanej `producedQty/batchSize`, +VYROBA s `batchId`; pri nedostatku surovín slovenská chyba, žiadne záporné stavy; exspirácie |
| `feat/plan-dashboard` | Plnenie plánu (ciele `MonthlyPlan` vs. live skutočnosť z faktúr/šarží/eKasa), Dashboard KPI |

Vlastné adresáre: `src/app/(app)/{sklad,vyroba,plan}/`, `src/app/(app)/page.tsx` (dashboard).

### Dev B — „Obchod a financie“

| Branch | Obsah |
|---|---|
| `feat/klienti-objednavky` | Klienti CRUD + detail s históriou; objednávky CRUD s položkami a stavmi (expedícia → −PREDAJ pohyby, číslovanie cez `nextNumber(tx, "OBJ", rok)`); predplatné + tlačidlo „Vygenerovať objednávky“; inbox stránka (zoznam, detail, „Vytvoriť objednávku“) |
| `feat/financie` | Vystavenie faktúry z objednávky (`nextNumber(tx, "VYDANA", rok)`, DPH per riadok cez `computeTotals`), ručné +/− faktúry, tlačiteľný detail |
| `feat/import-export` | **SuperFaktúra import** (CSV upload + preview + `importExternalInvoice()` — už existuje v `src/lib/invoicing.ts`), web faktúry cez `/api/inbox`, párovanie klientov (`matchOrCreateClient`: IČO → e-mail → meno), **CSV export pre účtovníka** (`/financie/export`: obdobie/smer/zdroj → interné číslo, externé číslo, zdroj, klient, IČO, DIČ, dátumy, základ, DPH, spolu, VS), eKasa CSV import s dedupliáciou, prehľad marží |

Vlastné adresáre: `src/app/(app)/{klienti,objednavky,financie,konkurencia}/`, `src/app/api/`.

## Verifikácia (pred každým PR)

- `npx tsc --noEmit` prejde, `npm run dev` beží bez chýb
- **Golden path:** login → príjem zázvoru → šarža 100 ks → dokončiť (surovina ↓, produkt ↑) → objednávka 50 ks → EXPEDOVANA (produkt −50) → faktúra FA2026xxx → Dashboard/Plán sedia
- **Import path:** SuperFaktúra CSV import 2× → žiadne duplikáty; export CSV obsahuje interné aj externé ID; `POST /api/inbox` bez API kľúča → 401
- Edge: šarža bez surovín → chyba; duplicitný eKasa import → bez duplikátov

## Neskôr (mimo v1)

- E-mail parsing do inboxu (IMAP/forwarding → `POST /api/inbox`)
- SuperFaktúra API sync (rovnaký `ExternalInvoiceInput` mapper ako CSV)
- ~~Napojenie modelu na sledovanie konkurencie (`GET /api/konkurencia`)~~ — hotové (FULL SINTEL, PR feat/konkurencia-sintel)
- Prechod SQLite → Postgres (zmena providera + DATABASE_URL + nové migrácie)
- XLSX export, automatické generovanie objednávok z predplatného (cron)
