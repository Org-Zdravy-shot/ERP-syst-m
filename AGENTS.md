<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ERP Zdravý shot — pravidlá pre vývoj (obe Claude Code sessions)

## Next.js 16 — najdôležitejšie odchýlky

- `middleware.ts` je deprecated → používame `src/proxy.ts` s `export function proxy()`
- Request APIs (`cookies()`, `headers()`, `params`, `searchParams`) sú **async** — vždy `await`
- Turbopack je default

## Projekt

- **Stack:** Next.js 16 (App Router, TS), Prisma 6 + SQLite (`prisma/dev.db`, neskôr Postgres), Tailwind v4, iron-session + bcryptjs, zod 4
- **UI kompletne po slovensky.** Texty pre používateľa VŽDY po slovensky
- **Peniaze = integer centy.** Nikdy Float pre sumy. Formátovanie len cez `formatCents()` z `src/lib/format.ts`; parsovanie vstupu cez `parseEurToCents()`
- **Enumy nie sú v DB** (SQLite) — povolené hodnoty stráži `src/lib/zod-schemas.ts`. Pri novom „enume" pridaj zod schému + labels mapu tam
- **Sklad = pohybový ledger.** Stav zásob NIKDY neukladaj — vždy SUM cez helpery v `src/lib/stock.ts`. Pohyby majú signed quantity (+príjem/−výdaj) a presne jedno z `materialId`/`productId`
- **Číslovanie dokladov** (faktúry, objednávky, šarže) VŽDY cez `nextNumber(tx, kind, year)` z `src/lib/invoicing.ts`, vnútri `prisma.$transaction`
- **Import externých faktúr** (SuperFaktúra, web) cez `importExternalInvoice()` — idempotentné vďaka `@@unique([source, externalId])`

## Architektúra

- Čítanie dát: **server components** s priamymi Prisma queries (žiadna fetch vrstva)
- Mutácie: **server actions** v `_actions.ts` v adresári modulu. Vzor: zod validácia → `requireUser()` → `prisma.$transaction` → `revalidatePath` → redirect/return
- API routes LEN pre externé systémy: `POST /api/inbox` (x-api-key), `GET /api/konkurencia`
- Komponenty modulu v jeho adresári, zdieľané v `src/components/`
- Client components len kde treba interaktivitu (formuláre s riadkami položiek, CSV preview)

## GitHub workflow pre 2 paralelné sessions

- `main` = vždy funkčný. Feature branchy `feat/*`, malé PR, merge cez GitHub
- **Pred začatím práce vždy:** `git pull origin main` a rebase svojho branchu
- **Rozdelenie vlastníctva (minimalizuje konflikty):**
  - Dev A: `src/app/(app)/{sklad,vyroba,plan}/`, `src/app/(app)/page.tsx`
  - Dev B: `src/app/(app)/{klienti,objednavky,financie,konkurencia}/`, `src/app/api/`
- **Zmeny `prisma/schema.prisma` alebo `src/lib/`** = samostatný malý PR, druhý dev ho okamžite zmerguje a pullne. Migrácie nikdy needituj spätne — vždy nová migrácia
- Po pullnutí zmien schémy: `npx prisma migrate dev`

## Príkazy

```bash
npm run dev          # dev server (Turbopack)
npx tsc --noEmit     # typecheck — spusti pred každým PR
npx prisma studio    # prehliadač DB
npx prisma db seed   # znovu nasadí demo dáta (najprv zmaž prisma/dev.db)
```

Prihlásenie (seed): `admin@zdravyshot.sk` / `zdravyshot123` (aj katka@, miro@).

## Plán práce

Aktuálne rozdelenie úloh a stav je v PLAN.md — po dokončení fázy si odškrtni checkbox v rámci svojho PR.
