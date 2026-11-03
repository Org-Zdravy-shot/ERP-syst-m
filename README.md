# Zdravý shot ERP

Interný ERP systém pre Zdravý shot — výroba, sklad, objednávky, financie, plnenie plánu.

## Rýchly štart

Lokálny vývoj aj produkcia používajú PostgreSQL. Po vytvorení lokálnej databázy:

```bash
npm install
cp .env.example .env        # nastav DATABASE_URL, SESSION_SECRET a INBOX_API_KEY
npx prisma migrate dev
npx prisma db seed          # iba lokálne/demo prostredie
npm run dev                 # http://localhost:3000
```

Prihlásenie: `admin@zdravyshot.sk` / `zdravyshot123`

Demo prihlasovanie platí iba po lokálnom seede. Produkčnú databázu seedujte len vedome a heslá okamžite zmeňte.

## Railway produkcia

- Web služba: GitHub vetva `main`, build `npm run build`, start `npm start`.
- PostgreSQL: `DATABASE_URL` je referenčná premenná z Railway Postgres služby.
- Pre-deploy command: `npm run db:deploy`.
- Povinné secrets: `SESSION_SECRET`, `INBOX_API_KEY` (náhodné hodnoty s aspoň 32 znakmi).
- Produkčný seed sa automaticky nespúšťa.

### Lokálna záloha produkcie

Po nainštalovaní Railway CLI a PostgreSQL klienta (`brew install libpq`) spustite:

```bash
npm run backup:production
```

Skript číta verejný TCP endpoint služby `Postgres` v produkčnom projekte
`16793114-d228-43d9-a257-64cbf4007933`; nepotrebuje lokálny `.env` ani službu `web`.
Na macOS automaticky nájde aj klienta z Homebrew `libpq` mimo `PATH`.
Dump sa najprv overí cez `pg_restore --list`, potom sa uloží do ignorovaného
adresára `backups/` s oprávnením iba pre lokálneho používateľa. Až po úspechu
sa odstránia lokálne zálohy staršie ako 30 dní. Cieľ možno zmeniť premennými
`BACKUP_RAILWAY_PROJECT_ID`, `BACKUP_RAILWAY_ENVIRONMENT`,
`BACKUP_RAILWAY_DATABASE_SERVICE` a `BACKUP_DIR`.

### Automatické zálohy

Railway služba `database-backup` používa samostatný Docker obraz z `ops/backups/`.
Denne o **02:00 UTC** vytvorí PostgreSQL dump a kópie dokumentov do samostatného
privátneho bucketu `database-backups`. Každý nahraný súbor znovu stiahne a overí
SHA-256. Databázové snapshoty a manifesty uchováva 30 dní; obsahovo adresované
kópie nemenných dokumentov zostávajú zachované aj pre historické obnovy.
Zlyhanie skončí nenulovým exit kódom a neodstráni staršie zálohy.

V tomto účte nie sú natívne Railway snapshoty dostupné bez Pro plánu;
automatické zálohy preto používaný plán nemenia. Výsledok každej úlohy je
v Railway logoch (`backup_verified` alebo `backup_failed`).

Obnova: stiahnuť príslušný `database/*.dump` a `manifests/*.json`, obnoviť dump
cez `pg_restore --no-owner --no-acl` do **novej prázdnej databázy** a podľa
manifestu nahrať dokumenty z `documents/<sha256>` pod ich `originalKey` do
cieľového dokumentového bucketu. Pri zmene bucketu upraviť `DocumentAsset.bucket`.
Pred prepnutím aplikácie porovnať tabuľky a overiť sťahovanie dokumentu.

Pôvodná adresa `https://erp-syst-m-production.up.railway.app` patrí po migrácii
priamo novej aplikácii; existujúce integračné URL sa preto nemenia.

## Dokumentácia

- **[PLAN.md](PLAN.md)** — plán práce a rozdelenie medzi Dev A / Dev B
- **[AGENTS.md](AGENTS.md)** — konvencie, architektúra a GitHub workflow (číta ho aj Claude Code)

## Moduly

Dashboard · Výroba (receptúry, šarže) · Sklad (pohybový ledger) · Objednávky (+ predplatné, inbox) · Plnenie plánu · Financie (faktúry interné + web + SuperFaktúra, eKasa, export) · Klienti · Konkurencia (pripravený stub)

## Externé vstupy

- `POST /api/inbox` (hlavička `x-api-key`) — objednávky/dopyty z webu, neskôr e-maily
- `GET /api/konkurencia` — stub pre budúci model sledovania konkurencie
