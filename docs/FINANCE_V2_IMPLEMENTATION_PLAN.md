# Financie v2 — implementačný a cutover plán

> Stav dokumentu: aktuálny k 28. júlu 2026. Aktuálny remaining split nižšie
> nahrádza pôvodné pridelenie A/B/C v historických častiach dokumentu.

## Stav implementácie

- [x] Koordinačný plán — [PR #8](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/8)
- [x] A0 spoločná schéma, migrácia a kontrakty — [PR #9](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/9)
- [x] A1 doménový workflow, go-live gate a testy — [PR #10](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/10)
- [x] A2 finančné obrazovky, dobropisy, roly a účtovnícky export — PR
  [#11](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/11),
  [#12](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/12),
  [#14](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/14) a
  [#15](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/15)
- [x] B nemenné PDF, PAY by square a privátny bucket —
  [PR #17](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/17)
- [x] C1 bankové výpisy, platby, párovanie, cash-flow a cron —
  [PR #13](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/13)
- [x] D Omega import a vyradenie SuperFaktúry —
  [PR #18](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/18),
  [#19](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/19),
  [#20](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/20) a
  [#21](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/21)
- [x] E e-mail, outbox, retry a upomienky —
  [PR #16](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/16) a produkčný
  hardening v [PR #22](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/22)
- [x] Doplnkový VRP2 XLSX import —
  [commit `9052bf9`](https://github.com/Org-Zdravy-shot/ERP-syst-m/commit/9052bf9793be2e858c200cc2d5f1afab851a9719)
- [x] Railway Bucket kompatibilita s virtual-hosted S3 URL —
  [PR #24](https://github.com/Org-Zdravy-shot/ERP-syst-m/pull/24)
- [ ] Produkčný cutover a externé integrácie podľa remaining splitu nižšie

## Aktuálny remaining split

### Developer A — go-live integrácia

- získať písomné potvrdenie účtovníka pre dátum registrácie DPH, historický
  hraničný dátum a sadzbu každého fakturovateľného produktu;
- overenie k 28. júlu 2026 nepotvrdilo plošnú sadzbu 23 %: pri zatriedení
  štiav do `ex 2009` platí podľa
  [Finančnej správy](https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty/sadzby-dane)
  sadzba 5 % pre šťavy bez pridaného cukru alebo najviac s 5 g pridaného
  cukru na 100 ml; nad tento limit alebo pri inom zatriedení môže platiť 23 %.
  Keďže verejné zloženie produktov uvádza med, pred nastavením ERP treba
  potvrdiť KN kód a množstvo pridaného cukru na 100 ml pre každý recept;
- [x] vytvoriť privátny Railway Bucket v regióne Amsterdam, nastaviť jeho
  produkčné premenné a overiť upload, download aj SHA-256;
- [x] nastaviť Railway cron: outbox každých 5 minút, bankový sync každých
  15 minút a upomienky denne o 07:00 UTC; produkčný test skončil bez backlogu
  a bankový job sa pri vypnutom Tatra flage korektne preskočil;
- nakonfigurovať transakčný SMTP, `info@zdravyshot.sk` a DKIM; existujúce SPF
  ani DMARC nemeniť bez kontroly;
- [x] obnoviť predimportnú produkčnú zálohu do izolovanej dočasnej databázy,
  overiť obnovenú schému a dáta a dočasnú databázu následne odstrániť;
- vykonať bezpečnostnú kontrolu a spoločný E2E scenár od objednávky po
  účtovnícky export;
- zapnúť `FINANCE_PRODUCTION_ISSUING_ENABLED` až po splnení všetkých go-live
  kontrol.

### Developer D — produkčný import dokončený, zostáva organizačný cutover

- [x] dry-run reálneho `export.zip` bol 28. júla 2026 úspešný bez chýb:
  5 partnerov, 8 vydaných a 2 prijaté faktúry, 27 položiek, vydané
  `498,70 €`, prijaté `47,89 €`, ďalšie číslo `2026009`;
- [x] pred commitom bola vytvorená produkčná databázová záloha
  `zdravy-shot-20260725-001123.dump` s kontrolným SHA-256
  `a75f986cd18c5672439b0f9261920920848ed848f872825f1c26a3656ec46da9`;
- [x] importná dávka bola commitnutá auditovaným administrátorom a opätovne
  overená: všetkých 8 vydaných aj obe prijaté faktúry majú plnú platobnú
  alokáciu, rady sú `VYDANA-2026 = 8` a `PRIJATA-2026 = 2` a ďalšie vydané
  číslo je `2026009`;
- po akceptácii presunúť posledné exporty Omegy a SuperFaktúry do zabezpečeného
  archívu a nepoužívať ich na nové doklady.

### Developer C — externá Tatra banka

- dokončiť aktiváciu Premium API, consent/reconnect flow, šifrované obnovovanie
  tokenu a kontraktné testy v oficiálnom sandboxe;
- `TATRA_PREMIUM_ENABLED` ponechať vypnuté, kým aktivácia a sandbox neprejdú;
  dovtedy je podporovaný kontrolovaný import bankového výpisu.

### Zostávajúce funkčné rozšírenia

- doplniť nahrávanie všeobecných príloh prijatých faktúr do privátneho bucketu;
- podľa zvoleného mail providera doplniť webhook pre `DELIVERED` a `BOUNCED`;
- druhá etapa: vybrať certifikovaného eFaktúra providera do septembra 2026,
  zapojiť sandbox do októbra a produkciu najneskôr v decembri 2026.

## 1. Cieľ a hranice prvej etapy

ERP bude jediný pracovný systém pre:

- vydané a prijaté faktúry,
- dobropisy a nemenné PDF,
- odoslanie e-mailom a upomienky,
- platby, bankové transakcie a párovanie,
- náklady, finančné prehľady a export pre účtovníka,
- audit a idempotentný import historických dát.

Účtovník zostáva zodpovedný za zákonné účtovníctvo a podania. Prvá etapa
podporuje EUR a slovenské domáce doklady. Cudzie meny a OSS nie sú súčasťou
prvého produkčného releasu.

eFaktúra je druhá etapa. Do septembra 2026 sa vyberie certifikovaný
poskytovateľ, do októbra sa zapojí sandbox a produkčné odosielanie aj prijímanie
musí byť hotové najneskôr v decembri 2026. Samotné PDF nebude po 1. januári 2027
postačovať pre dotknuté doklady.

## 2. Blokátory produkčného vystavenia

Produkčná finalizácia faktúry musí zostať technicky zablokovaná, kým nie sú
splnené všetky body:

- účtovník potvrdil dátum registrácie spoločnosti pre DPH,
- každý fakturovateľný produkt má časovo platnú a potvrdenú sadzbu DPH,
- je nastavený časovo platný firemný a daňový profil,
- je nastavený EUR bankový účet spoločnosti,
- číselný rad vydaných faktúr je inicializovaný tak, aby nasledujúce číslo bolo
  presne `2026009`,
- privátny Railway Bucket a e-mailový provider pre `info@zdravyshot.sk` prešli
  integračnou kontrolou.

Historické doklady do júna 2026 zostanú bez DPH. Presný hraničný dátum musí pred
produkčným importom písomne potvrdiť účtovník.

## 3. Spoločný doménový kontrakt

### 3.1 Stavy a nemennosť

Faktúra má dve oddelené osi:

- `documentStatus`: `DRAFT`, `ISSUED`, `CANCELLED`,
- vypočítaný `paymentStatus`: `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERPAID`.

`paymentStatus` sa nikdy nemení ručne. Počíta sa zo sumy aktívnych alokácií
platieb voči celkovej sume dokladu. Stav po splatnosti je odvodený z dátumu
splatnosti, nie je samostatným ručne ukladaným stavom.

Po prechode do `ISSUED` sú právne a účtovné údaje dokladu nemenné. Oprava sa
robí dobropisom s väzbou na pôvodnú faktúru. Storno je auditovaná doménová
operácia; nesmie zmazať faktúru, PDF, odoslania ani platobnú históriu.

### 3.2 Snapshoty

Finalizovaná faktúra nesmie čítať historické údaje z aktuálneho klienta,
produktu ani firemného profilu. Pri finalizácii sa uložia snapshoty:

- dodávateľa vrátane názvu, adries, IČO, DIČ, IČ DPH, kontaktov a bankového účtu,
- odberateľa alebo dodávateľa prijatej faktúry,
- daňového režimu, registrácie DPH a dátumu dodania,
- každej položky vrátane popisu, množstva, jednotky, jednotkovej ceny a sadzby
  DPH.

Peniaze sa ukladajú výhradne ako celé centy. DPH sa zaokrúhľuje na cent po
položkách a až potom sa sčítava.

### 3.3 Cieľové spoločné modely

Prvú migráciu vlastní developer A. Minimálny spoločný model obsahuje:

- `CompanyProfile` a časovo platný `TaxProfile`,
- časovo platné a potvrdené sadzby DPH produktov,
- rozšírené `Invoice` a `InvoiceItem` so snapshotmi a dobropisovou väzbou,
- `Payment` a `PaymentAllocation`,
- `BankAccount`, `BankConnection` a `BankTransaction`,
- `DocumentAsset` pre nemenné PDF a prílohy vrátane SHA-256,
- `EmailDelivery` a databázový `OutboxEvent`,
- `ImportBatch` s hashom vstupu, stavom, súhrnom a auditným záznamom,
- `AuditLog`.

Enumy sa v databáze nepoužívajú. Povolené hodnoty a slovenské labely patria do
`src/lib/zod-schemas.ts`.

### 3.4 Rozhrania, ktoré publikuje developer A

Rozhrania budú v prvom bootstrap PR a ostatné implementácie ich budú iba
importovať:

```ts
interface InvoiceService {
  createDraft(input: CreateInvoiceDraftInput): Promise<InvoiceResult>;
  calculate(input: CalculateInvoiceInput): InvoiceCalculation;
  finalize(invoiceId: string, actorId: string): Promise<FinalizedInvoice>;
  createCreditNote(input: CreateCreditNoteInput): Promise<InvoiceResult>;
  exportAccounting(input: AccountingExportInput): Promise<AccountingExport>;
}

interface DocumentService {
  generateAndStoreInvoicePdf(invoiceId: string): Promise<StoredDocument>;
  verifyHash(documentId: string): Promise<boolean>;
}

interface MailProvider {
  send(message: MailMessage): Promise<MailResult>;
  getDeliveryStatus(providerMessageId: string): Promise<MailDeliveryStatus>;
}

interface BankProvider {
  listAccounts(): Promise<BankAccountResult[]>;
  getBalances(): Promise<BankBalanceResult[]>;
  syncTransactions(cursor?: string): Promise<BankSyncPage>;
  reconnect(): Promise<void>;
}

interface EInvoiceProvider {
  send(invoiceId: string): Promise<EInvoiceResult>;
  receive(cursor?: string): Promise<EInvoicePage>;
  getStatus(providerDocumentId: string): Promise<EInvoiceStatus>;
}
```

`TatraPremiumApiProvider` implementuje `BankProvider`. Prvá etapa dodá
`EInvoiceProvider` iba ako kontrakt a vypnutú implementáciu.

## 4. Vlastníctvo a vetvy

### Developer A — finančné jadro a integrácia

Vetva: `feat/finance-domain-v2`

Vlastní:

- `prisma/schema.prisma` a všetky finančné migrácie,
- `src/lib/zod-schemas.ts`,
- spoločné typy a kontrakty v `src/lib/finance/`,
- fakturačnú doménu, výpočty, workflow, oprávnenia a audit,
- vydané/prijaté faktúry, dobropisy, nastavenia a účtovnícky export,
- integráciu PR developerov B a C.

Prvé PR developera A obsahuje iba spoločnú migráciu, kontrakty, validačné
schémy, testovacie fixtures a vygenerovaný Prisma klient. Po jeho merge B a C
okamžite rebasujú. Každá ďalšia zmena spoločnej schémy alebo kontraktu ide cez
malé samostatné PR developera A.

### Developer B — dokumenty, e-mail a historická migrácia

Vetva: `feat/finance-documents-migration`

Vlastní:

- `src/lib/finance/documents/`,
- `src/lib/finance/mail/`,
- `src/lib/finance/import/omega/`,
- obrazovky a route handlery pre dokumenty, e-mail a Omega import.

Dodá:

- profesionálnu slovenskú faktúru s rozpisom DPH, IBAN a slovenským platobným
  QR kódom,
- nemenné uloženie PDF/príloh do privátneho Railway Bucketu so SHA-256,
- autorizovaný download bez verejných bucket URL,
- odoslanie z `info@zdravyshot.sk`, evidenciu výsledku, retry a upomienky cez
  databázový outbox,
- Omega TXT import ZIP/Windows-1250 s `--dry-run` a `--commit`, validáciou,
  náhľadom a idempotenciou.

Developer B nesmie commitnúť reálne exportované dáta, ZIP, PDF ani tajomstvá a
nesmie ich vložiť do `prisma/seed.ts`.

### Developer C — Tatra banka, platby a finančný prehľad

Vetva: `feat/tatra-bank-sync`

Vlastní:

- `src/lib/finance/banking/`,
- `src/lib/finance/matching/`,
- obrazovky banky, manuálnej kontroly, cash-flow a neuhradených faktúr,
- route handler pre Railway cron synchronizáciu.

Dodá:

- `TatraPremiumApiProvider` podľa dodanej dokumentácie a sandboxu,
- feature flag, kým Tatra Premium API neprejde aktiváciou,
- šifrované uloženie obnoviteľných tokenov; certifikáty, kľúče a ostatné
  tajomstvá zostanú iba v Railway variables,
- idempotentný 15-minútový sync podľa bankového identifikátora,
- dočasný import bankového výpisu,
- automatické párovanie a manuálnu kontrolu.

Poradie párovania:

1. presný variabilný symbol + suma + mena,
2. jednoznačný IBAN + suma + tolerancia dátumu,
3. inak manuálna kontrola.

Čiastočné, nadmerné a nejednoznačné úhrady sa nesmú automaticky uzavrieť bez
záznamu alokácie a kontroly.

## 5. Ako môžu B a C začať ihneď

1. Vytvoria svoje vetvy z `main` po merge tohto dokumentu.
2. Môžu pripraviť provider adaptéry, čisté transformácie, fixtures a kontraktné
   testy vo svojich vlastnených adresároch.
3. Kým nie je merge prvého bootstrap PR developera A, nemenia Prisma schému,
   `src/lib/zod-schemas.ts`, existujúci `src/lib/invoicing.ts` ani finančné
   server actions.
4. Po merge bootstrap PR vykonajú `git rebase origin/main`,
   `npx prisma generate` a zapoja implementácie na publikované kontrakty.
5. Chýbajúce pole alebo kontrakt nahlásia developerovi A; nevytvoria paralelnú
   migráciu.

Všetky tri vetvy musia zostať malé a deliteľné na samostatné PR. Pred každým PR
sa branch rebasuje na aktuálny `origin/main`.

## 6. Historický import `export.zip`

Import pred zápisom vytvorí produkčnú zálohu a následne prejde celým obsahom v
jednej databázovej transakcii. Pri neočakávaných existujúcich produkčných
faktúrach alebo kolízii čísla skončí bez čiastočného zápisu.

Očakávaný výsledok:

| Kontrola | Očakávanie |
|---|---:|
| Partneri | 5 |
| Vydané faktúry | 8 (`2026001` až `2026008`) |
| Prijaté faktúry | 2 |
| Položky | 27 |
| Vydané spolu | 498,70 € |
| Prijaté spolu | 47,89 € |
| Uhradené vydané faktúry | 8 |
| Nasledujúce vydané číslo | `2026009` |

Pri partnerovi SRRZ import:

- označí nesúlad IČO,
- zachová pôvodný riadok v audite,
- použije overený údaj z partnerskej sekcie.

Hash vstupného ZIP a externé identifikátory zabezpečia, že opakovaný import
nevytvorí duplikáty.

## 7. Bezpečnosť a prístupy

- Financie sú predvolene dostupné iba administrátorovi.
- Nové roly sú `FINANCE_ADMIN` a `FINANCE_OPERATOR`.
- Operátor nemôže meniť daňový profil, číselný rad, bankové spojenie ani
  stornovať/finalizovať doklad bez explicitného oprávnenia.
- Každá finalizácia, storno, dobropis, alokácia, odpojenie banky, import a
  autorizovaný download vytvorí auditný záznam.
- PDF a prílohy sú privátne, obsahujú kontrolný hash a nikdy sa nelogujú ako
  base64 ani verejná URL.
- Existujúce SPF a DMARC záznamy sa nemenia naslepo. DKIM sa pridá podľa
  zvoleného transakčného poskytovateľa po DNS kontrole.

## 8. Testy a akceptácia

### Developer A

- centové výpočty a zaokrúhlenie DPH po položkách,
- daňové obdobia a go-live gate,
- súbežná finalizácia a nasledujúce číslo `2026009`,
- povolené prechody, nemennosť a dobropisy,
- payment status zo súčtu alokácií,
- role, audit a účtovnícky export.

### Developer B

- CP1250, poškodený ZIP, neznámy riadok a opakovaný import,
- presné počty a sumy historickej migrácie,
- nemennosť snapshotu, hash PDF a údaje QR,
- autorizovaný download, e-mailové retry a idempotentný outbox.

### Developer C

- sandbox autentifikácia, obnova tokenu, stránkovanie a výpadok API,
- duplicitná banková transakcia,
- presná, čiastočná, nadmerná a nejednoznačná platba,
- feature flag a dočasný import výpisu.

### Spoločný E2E scenár

`objednávka → koncept → kontrola → finalizácia 2026009 → PDF → e-mail → banková
úhrada → PAID → export pre účtovníka`

Pred release musia prejsť:

```bash
npm run typecheck
npm run build
npm test
```

Okrem toho sa vykoná obnovovací test zálohy a produkčný dry-run importu. Po
cutover sa SuperFaktúra ani Omega nepoužijú na nové doklady; posledné exporty
zostanú iba v zabezpečenom archíve.

## 9. Poradie integrácie

1. **A0:** spoločná schéma, migrácia, kontrakty, validácie a fixtures.
2. **A1:** výpočty, daňové profily, workflow, číslovanie a go-live gate.
3. **B1 / C1 paralelne:** dokumenty a mail / bankový provider a sync.
4. **A2:** prijaté faktúry, dobropisy, role, audit a export.
5. **B2 / C2 paralelne:** Omega migrácia / párovanie a reporty.
6. **Integrácia:** E2E, bezpečnostná kontrola, dry-run, záloha a cutover.

Definition of Done každého PR:

- žiadne tajomstvá ani reálne finančné dáta v Gite,
- migrácie sa spätne neupravujú,
- nové mutácie majú autorizáciu, validáciu a audit,
- idempotentné operácie majú databázovú unikátnosť alebo idempotency key,
- `npm run typecheck`, relevantné testy a `npm run build` prejdú.

## 10. Referencie

- [Finančná správa — eFaktúra](https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty/e-faktura)
- [Railway — Storage Buckets](https://docs.railway.com/storage-buckets)
- [Tatra banka — Otvorené bankovníctvo](https://www.tatrabanka.sk/sk/personal/ucet-platby/otvorene-bankovnictvo/)
