# Fakturácia v ERP — návrh celého prostredia a zadanie pre implementáciu

22. 11. 2026 · Návrh fakturačného prostredia. Stav implementácie je v kapitole 8.

## 1. Výsledok pre používateľa

Používateľ otvorí fakturáciu a nájde známe pracovné postupy zo SuperFaktúry v samostatnom rozhraní Zdravého Shotu. Vlastné skladové, výrobné a obchodné dáta sú prepojené s dokladmi.

Celý cieľ zahŕňa prehľady, všetky typy obchodných dokladov, ich vytváranie a nadväznosť, náklady, kontakty, platby, odosielanie, exporty, nastavenia a Peppol. Jednotlivé funkcie sa sprístupnia až s fungujúcim backendom. Žiadne tlačidlá predstierajúce uloženie, platbu alebo doručenie.

Presná zhoda s aktuálnou SuperFaktúrou nie je overená: prístup k editoru blokovalo skončené členstvo a pri poslednej kontrole vypršalo prihlásenie. Priamo preskúmané obrazovky a oficiálne verejné materiály sú referenciou; nevidené detaily sú nižšie vlastným návrhom. Obnovenie predplatného nie je podmienkou pokračovania v implementácii tohto návrhu.

## 2. Mapa prostredia

```text
ZDRAVÝ SHOT     [ Hľadať doklad alebo kontakt… ]    Nápoveda  Firma ▾  Profil ▾
PREHĽADY | FAKTÚRY | NÁKLADY | KONTAKTY | NÁSTROJE             [+ Vytvoriť nový ▾]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Obsah vybranej agendy
```

| Hlavná agenda | Podsekcie v konečnom rozsahu |
|---|---|
| Prehľady | Fakturácia, Cash flow, Pohľadávky a záväzky, Marže a prevádzka |
| Faktúry | Všetky doklady, Faktúry, Zálohové faktúry, Daňové doklady k platbe, Vyúčtovania, Dobropisy, Cenové ponuky, Objednávky, Dodacie listy, Pravidelné doklady, Koncepty |
| Náklady | Všetky, Na spracovanie, Neuhradené, Po splatnosti, Pravidelné náklady, Kategórie |
| Kontakty | Odberatelia, Dodávatelia, Všetky kontakty, Archivované |
| Nástroje | Banka a párovanie, Import, Export, eKasa, Katalóg položiek, eFaktúra/Peppol, História operácií |
| Profil → Nastavenia | Moje firmy, DPH, Účty, Číselné rady, Vzhľad PDF, Predvolené hodnoty, E-maily, Prístupy, Integrácie |

Veľký počet podsekcií faktúr nezapĺňa jediný vodorovný riadok: hlavné typy sú v záložkách, ostatné v menu „Ďalšie doklady“. Platobné filtre sú samostatné. Sklad, výroba, plán a ostatné ERP moduly sú dostupné cez „Späť do ERP“; netvoriť ich druhú kópiu vo fakturácii.

**Výber firmy:** Kurgi / živnosť / všetky. Aktívna firma je vždy viditeľná, prenáša sa do zoznamov, grafov a nových dokladov. „Všetky“ je iba režim prehľadu, nový doklad musí mať konkrétneho vystaviteľa. Prepnutie firmy pri rozpísanom doklade vyvolá potvrdenie zahodenia zmien alebo explicitný prepočet; nesmie ticho preniesť sadzby, účet či číselný rad inej firmy. Daňový profil sa vyberá podľa dátumu, nie iba podľa aktuálneho stavu.

**Vyhľadávanie v hlavičke:** konečný cieľ je skupinový výsledok Doklady / Kontakty, vstup názov, IČO, číslo a VS. Prvá implementácia zatiaľ hľadá iba doklady a firmy na nich; text musí presne označovať rozsah. Online register firiem je súčasť výberu odberateľa a kontaktov, nie automatické prehľadávanie webu pri každom hľadaní dokladu.

## 3. Vizuálny systém

- Pozadie `#F5F5F4`, biely dokument a tabuľky, čierna `#202020`, žltá `#FFD52E`. Žltá pre hlavnú akciu a aktívny prvok, nie pre celé pozadie.
- Maximum obsahu 1380 px, okraje 32 px na desktope a 18 px na mobile. Tmavá pracovná lišta s označením ZS, vyhľadávaním a profilom má na desktope 74 px. Pod ňou sú svetlé záložky agend a žltá hlavná akcia.
- Nadpis stránky 23–26 px, bežný text 13–14 px, popisky 11–12 px; číselné stĺpce zarovnané doprava a číslice s rovnakou šírkou. Dlhé čísla a mená sa nesmú prekrývať.
- Polia a panely s rohmi 4–5 px, jemné oddeľovače, minimálne tiene. Husté pracovné tabuľky, nie veľké marketingové karty. Jeden dominantný primárny úkon na obrazovku.
- Výstrahy a chyby môžu používať červenú; úspech zelenú. Vždy aj text/ikona, nie iba farba. Žlté tlačidlo má tmavý text.
- Jednotné stavy: načítanie, prázdna agenda, prázdny výsledok filtra, chyba, zakázaná akcia s dôvodom, úspešné uloženie. Žiadne ukážkové sumy v skutočnej agende.
- Klávesnica: viditeľný fokus, pomenované polia, logické poradie Tab, Escape zavrie menu; po chybe fokus na prehľad chýb a odkazy na konkrétne polia. Rozpísané hodnoty zostávajú zachované.
- Do 800 px sa panely skladajú pod seba; hlavná akcia je dostupná bez vodorovného posunu celej stránky. Tabuľka môže mať vlastný posuv. Do 480 px dodávateľ a odberateľ pod sebou. Overiť 1440, 1024, 768 a 390 px.

## 4. Obrazovky a ich správanie

### A. Prehľady — `/financie`

```text
Prehľady                                           [Firma ▾]
┌ Fakturácia | Cash flow | Pohľadávky a záväzky ─────── ‹ 2026 › ┐
│ Vyfakturované           │ [Mesiace / Kvartály / Rok]           │
│ Neuhradené              │                                    │
│ Náklady                 │  graf príjmov, nákladov a rozdielu  │
│ Neuhradené náklady       │                                    │
│ ────────────────────   │  legenda · s DPH / bez DPH          │
│ Rozdiel                 │                                    │
└────────────────────────┴────────────────────────────────────┘
┌ Čakajú na úhradu ────────────┐  ┌ Posledné doklady ──────────┐
│ číslo, partner, termín, suma │  │ číslo, partner, dátum, suma│
└─────────────────────────────┘  └────────────────────────────┘
```

Fakturácia používa vydané účtovné doklady podľa vystavenia, dobropisy odpočítava; koncepty, storná a predfaktúry nie sú výnos. Cash flow používa skutočné platby podľa dátumu platby. Rozdiel fakturácie a nákladov neoznačovať za účtovný zisk. Jednotlivé meny nesčítať bez explicitného kurzového mechanizmu; prvá verzia EUR a viditeľné označenie rozsahu.

Kliknutie na sumu otvorí zoznam s rovnakým subjektom, obdobím a významom. Neuhradené sumy sa rátajú zo živých alokácií platieb; pri historických nepotvrdených úhradách uviesť neistotu, nie vymyslené saldo. Panel „Čakajú na úhradu“ môže byť za všetky roky, ale musí to výslovne uviesť. Hranice dní určovať podľa Europe/Bratislava.

Akceptácia: zmena roka/subjektu mení graf aj súčty; nulové a záporné obdobie sa vykreslí správne; úhrada 40 € z faktúry 100 € nechá 60 €; dobropis nezvýši obrat; prepnutie s/bez DPH nikdy nemení bankový zostatok.

### B. Zoznam dokladov — `/financie/faktury`

Nadpis, hlavná akcia Nová faktúra; sekundárne Import a Export. Pod nadpisom typy dokladov, potom Všetky / Uhradené / Neuhradené / Po splatnosti. Vľavo kompaktné filtre, vpravo tabuľka; filtre zdroja a stavu riešiť výberom, nie desiatkami vertikálnych tlačidiel.

Stĺpce: výber, číslo a druh, partner, vystavenie/splatnosť, suma/neuhradené, stav dokladu a doručenia, menu akcií. Vystavenie, úhrada a doručenie sú tri rôzne stavy. Akcie riadka: detail, PDF, upraviť koncept, kopírovať, evidovať úhradu, odoslať, dobropis — podľa skutočných oprávnení a stavu.

Filtre: názov/číslo/VS, obdobie od–do alebo rok, firma, typ, stav, úhrada, zdroj. Uchovať v URL, stránkovanie na serveri a celkový počet. Export musí otvorene ukázať svoj rozsah; účtovný export nemusí byť totožný s exportom vybraných riadkov.

Hromadné operácie až v samostatnej fáze: PDF balík, export, odoslanie s kontrolou príjemcov a výsledkom každého dokladu. Nepovoliť hromadné prepisovanie vystavených dokladov.

Akceptácia: filtre sa nestratia po návrate z detailu; náklady majú správne záväzky a CTA; starší rok je viditeľný; stránkovanie nestráca ani neopakuje záznamy; každý odkaz vedie na existujúcu funkciu.

### C. Nová faktúra / úprava konceptu

```text
Nová faktúra
┌ DOKLAD ──────────────────────────────────────┐  ┌ Súhrn ──────────┐
│ Faktúra                 číslo po vystavení   │  │ Základ          │
│ Dodávateľ               Odberateľ            │  │ DPH podľa sadzieb│
│ firma, adresa, IČO       hľadať názov / IČO   │  │ Celkom          │
│ účet a daňový profil    doplnené údaje firmy  │  │                 │
│ Vystavenie   Dodanie   Splatnosť              │  │ Uložiť koncept  │
│ Položka | Množstvo | MJ | Cena | DPH | Spolu │  │ Náhľad          │
│ + Pridať položku                             │  │ Späť            │
│ Platobné údaje, VS, referencia odberateľa     │  └─────────────────┘
│ Poznámka; prílohy; rozšírené údaje            │
└──────────────────────────────────────────────┘
```

Dodávateľ z firemného profilu; odberateľ z lokálneho adresára aj online registra. Výber firmy vyplní názov, adresu, IČO, dostupné DIČ/IČ DPH. Zdroj a nedostupnosť registra viditeľné. Nový kontakt sa uloží priamo vo formulári bez straty položiek; existujúci sa bez výslovnej úpravy neprepíše. Podporiť osoby bez IČO a zahraničné kontakty ručne.

Položky: vyhľadávanie v katalógu aj voľný text, jednotka, množstvo, presná jednotková cena, sadzba, riadkový súčet. Následne zľava na položke/doklade, zmena poradia a kopírovanie riadka. Predvolené ceny podľa odberateľa; zobraziť pôvod ceny. Vyhľadanie produktu nesmie meniť už uloženú historickú položku.

FMCG ostáva zbalené pri konkrétnom riadku. Polia objednávky/dodania/šarže nie sú povinné pre obyčajnú faktúru, ale validačné pravidlá odberateľa ich môžu vyžadovať pred odoslaním. Chyba napr. „Riadok 3 – dátum exspirácie“ vedie na pole.

Prvá etapa zachová postup **Uložiť koncept → detail → skontrolovať a vystaviť**. Cieľový komfort „Vystaviť“ priamo z editora až cez rovnaký serverový proces: uložiť → validovať → finalizovať → detail. „Vystaviť a poslať“ navyše vyžaduje kontrolu adresáta/kanála a existujúcu spoľahlivú odosielaciu službu. Náhľad konceptu viditeľne označiť; nesmie prideliť číslo ani spustiť odoslanie.

Akceptácia: opakované kliknutie nepridelí dva doklady; chyba nezmaže formulár; zmena dátumu znovu overí daňový profil; súčet formulára, backendu, PDF a XML sa zhoduje na cent; editácia starej verzie konflikt zobrazí a nič neprepíše.

### D. Detail dokladu

Vľavo čitateľný dokument (dodávateľ/odberateľ, dátumy, položky, DPH, účet, QR, poznámky). Vpravo akcie v poradí pracovného postupu: upraviť koncept / vystaviť, PDF a tlač, poslať, evidovať úhradu, kopírovať, vytvoriť dobropis. Pod nimi úhrady, súvisiace doklady, prílohy, časová os. Technický Peppol protokol je v rozbaliteľnej sekcii; hlavná obrazovka ukazuje jednoduchý stav a konkrétny problém.

Koncept má jasné označenie a žiadne riadne číslo. Vystavená faktúra zobrazuje uložené snapshoty; zmena adresára ju neprepisuje. Odoslané providerovi neznamená doručené odberateľovi. Úhrady s možnosťou auditovaného zrušenia alokácie, nie prepísania sumy dokladu.

Akceptácia: každá akcia rešpektuje rolu/stav aj na serveri, kópia nemá staré úhrady a dodacie referencie, história vysvetlí vystavenie/odoslanie/opravu. Tlač neobsahuje navigáciu a bočný panel.

### E. Súhrnná faktúra a expedícia

Výber odberateľa a firmy → zoznam doručených nevyfakturovaných objednávok → dátumy a referencie každého dodania → kontrolný súhrn → koncept. Súčasná verzia podporuje 2–50 celých objednávok jedného mesiaca; tento limit zreteľne uviesť.

Ďalšia etapa prepája konkrétny riadok objednávky s výdajom a šaržou. Jeden produkt vo viacerých riadkoch sa nesmie párovať odhadom. Rozdelenie riadku na šarže nesmie meniť celkové množstvo ani účtovné sumy vplyvom zaokrúhlenia. Nejednoznačné staré pohyby vyžiadajú potvrdenie. GLN a referencie sa preberajú len z dôveryhodných zdrojov.

Akceptácia: jedna objednávka nemôže byť rezervovaná dvomi aktívnymi faktúrami; úprava zdroja sa odhalí; každá dodávka má svoje dátumy, DPH a referencie; 101ka potvrdí riadkové párovanie v reálnom dohodnutom testovacom kanáli.

### F. Náklady

Samostatná agenda s rovnakým vzorom zoznamu; hlavná akcia Nový náklad. Editor má dodávateľa, pôvodné číslo, dátumy, menu, položky/sadzby, kategóriu, prílohu a stav spracovania. Importovaný originál, bežný prijatý doklad a OCR návrh sú odlíšené. Historický formulár nesmie byť vydávaný za plnohodnotné vytváranie nového nákladu.

PDF/obrázok v náhľade vedľa polí, na mobile nad nimi. OCR neskôr iba navrhne polia; používateľ potvrdí údaje. Duplicitné prijatie cez nahratie aj Peppol kontrolovať podľa identity odosielateľa/dokladu a odtlačku; konflikt nesmie ticho zahodiť odlišný originál. Opakované náklady majú pravidlo, nie kopírovanú úhradu.

### G. Kontakty

Názov agendy „Kontakty“. Zoznam: firma/osoba, IČO, mesto, e-mail, typ, saldo s rozsahom, menu. Filtre odberateľ/dodávateľ, aktívny/archív, vyhľadávanie. Dodávateľský modul už existuje: pred zjednotením overiť jeho model, nepridať druhý nekonzistentný register.

Detail má hlavičku s Novou faktúrou a záložky Údaje / Doklady / Objednávky a dodania / Platby / Cenník / Poznámky. Údaje zahŕňajú adresy, viac kontaktov, splatnosť, jazyk/menu, GLN a Peppol identifikátor s overením. Automatické aktualizovanie z registra ponúkne porovnanie staré → nové; neprepisuje históriu. Archivácia zachová všetky väzby.

Akceptácia: meno alebo IČO nájde existujúceho partnera; opakované uloženie nevytvorí duplicitu; výpadok registra umožní ručný vstup; IČ DPH sa nevymýšľa z DIČ.

### H. Nástroje, platby a nastavenia

- **Banka:** zoznam účtov, výpisov a transakcií; náhľad importu, návrhy zhôd, nepotvrdené/čiastočné/preplatky, detail alokácií. Prijatá platba a vystavenie dokladu oddelené. Živá banka až po onboardingu; dovtedy fungujúci import.
- **Import/export:** sprievodca súbor → kontrola → náhľad → potvrdenie → výsledok. Zachovať pôvodné čísla, meny, prílohy a idempotenciu. Exportné formáty dopĺňať podľa konkrétnej špecifikácie a skúšky importu u účtovníka.
- **Katalóg:** odkaz na existujúce produkty s fakturačnými vlastnosťami; samostatné služby cez spoločný výber položky. Nevytvárať druhý sklad.
- **Peppol:** pripojenie za každý subjekt, overená identita, test/produkcia jasne odlíšené, odoslané/prijaté/chybové správy, kontrola a bezpečné opakovanie. Príjem vedie na náklad na kontrolu, nie automaticky na zaplatený doklad.
- **Nastavenia:** firma, časová platnosť DPH, účet, číselné rady, logo/PDF, predvolené termíny a texty, e-mailové šablóny, roly, integrácie. Pred zmenou číselného radu overiť kolízie; staré doklady nemení.
- **História:** kto/kedy/čo zmenil, stav fronty a chyby v zrozumiteľnom texte. Prístup podľa roly, tajné kľúče sa nikdy neposielajú klientovi.

### I. Zvyšné dokladové workflow — súčasť cieľa, samostatné etapy

| Workflow | Požadované správanie a hranica dokončenia |
|---|---|
| Cenová ponuka → objednávka → dodací list → faktúra | Každý doklad vlastné číslo/stav a snapshot; konverzia zachová väzby, cenu a rozsah; opakovaná konverzia nesmie zdvojiť dodanie. Existujúcu objednávkovú agendu znovu použiť. |
| Zálohová faktúra → platba → daňový doklad → vyúčtovanie | Záloha sa nezapočíta dvakrát do obratu ani platby; čiastočné/viacnásobné platby, viac záloh a vrátenie zálohy. Presné daňové a dátumové pravidlá pred kódovaním potvrdiť podľa účinných zdrojov a účtovníka. |
| Plný/čiastočný dobropis | Väzba na originál a opravované riadky, dôvod, kontrola už dobropisovaného množstva/sumy, úhrada/refundácia oddelene, správne PDF/XML. |
| Pravidelné faktúry | Šablóna, interval, začiatok/koniec, pozastavenie; unikátna realizácia per plánované obdobie aj pri súbehu jobov. Predvolene tvorba konceptu; automatické vystavenie/odoslanie až po samostatnom nastavení a overení. |
| Zľavy a meny | Jedno poradie výpočtu, presnosť cien, zľavy pred/po riadkovom zaokrúhlení explicitne určené. Kurz s dátumom/zdrojom uložený v doklade; účtovné a platobné kurzové rozdiely samostatne. |
| Upomienky a hromadné odoslanie | Náhľad adresátov, rešpektovanie úhrad/pozastavenia, deduplikácia pri retry, výsledok za každý doklad a audit. |
| Ďalšie daňové režimy a jazyky | Konkrétne scenáre s validačnými pravidlami a zodpovedajúcimi PDF/XML; nezavádzať voľbu, ktorú backend nepodporuje. |

Tieto workflow nesmú vzniknúť iba prepnutím textu „Faktúra“ na iný názov. Pri realizácii každého treba krátky samostatný návrh stavov, dát a účtovných príkladov; tento dokument určuje celkovú architektúru a poradie, nie neoverené účtovné pravidlá.

## 5. Technické hranice a opätovné použitie

Zachovať Next App Router, serverové čítanie cez Prisma, server actions, existujúcu autentifikáciu a oprávnenia. Peniaze celé centy; presné jednotkové ceny cez už existujúci decimal mechanizmus. Browser nesmie byť zdroj pravdy pre sadzbu, cenu z objednávky alebo finálnu sumu.

| Vrstva | Existujúci bod / cieľ |
|---|---|
| Obal aplikácie | `src/components/AppShell.tsx`, `src/app/(app)/layout.tsx`, `src/app/finance-workspace.css`; obmedziť finančné štýly na `.finance-workspace` |
| Prehľad | `financie/page.tsx`, `OverviewChart.tsx`, `overview-data.ts`; zdieľané definície filtrov a súm pre zoznamy |
| Editor | `faktury/nova/InvoiceForm.tsx`, `InvoiceCustomerPicker.tsx`, `form-options.ts`; postupne vyčleniť hlavičku, strany, položky, súhrn a akcie |
| Doklady | existujúci invoice-service, doménový výpočet, repository/PDF/UBL; nová UI nesmie vytvoriť paralelnú finalizáciu |
| Kontakty | existujúce company lookup/actions a adresár; pred rozšírením dodávateľov rozhodnúť identitu partnera na základe existujúcej schémy |
| Expedícia | Order → OrderItem → konkrétne StockMovement/batch; explicitná dohľadateľnosť, nie párovanie iba produktom |
| Platby a doručenie | existujúce alokácie, outbox, audit a integračné adaptéry; samostatné stavy a idempotency keys |
| Nové typy dokladov | najprv doménový návrh a aditívna migrácia, potom UI; zmeny `src/lib`/Prisma oddelené PR podľa AGENTS |

Pravidlá každého zápisu: autentifikácia/oprávnenie → validácia → transakcia so zámkom/verziou podľa operácie → audit → invalidácia správnych stránok. Číslo až pri finalizácii. Snapshoty vystaveného dokladu nemenné. Testovacie a produkčné identifikátory/kanály striktne oddelené.

## 6. Implementačné balíky pre lacnejší model

Každý balík je samostatne kontrolovateľný. Najprv dokončiť jeden, zmerať výsledok a až potom pokračovať. Stĺpec „review“ označuje odporúčanú kontrolu silnejším modelom, nie dodatočné povinné pýtanie súhlasu používateľa.

| ID | Rozsah a závislosť | Čo znamená hotovo | Review |
|---|---|---|---|
| P0 | Tento návrh + odovzdanie | Mapa, obrazovky, medzery, kritériá a presný pracovný stav uložené | Hotový návrh, používateľ ho môže pripomienkovať |
| P1 | Dokončenie obalu, spoločnej navigácie a komponentov | Všetky existujúce finančné stránky v jednom vizuálnom systéme; správne role; desktop/mobil | Vizuálna kontrola |
| P2 | Prehľady a zoznamy po P1 | Reálne súčty, filtre/odkazy, náklady správnym smerom, serverové stránkovanie, tests výpočtu | Agregácie a význam súm |
| P3 | Nová/úprava/kópia/detail faktúry po P1 | Celý lokálny klikací scenár, zachovanie hodnôt/chýb, PDF a akcie na správnom mieste | Výpočet a finalizačný prechod |
| P4 | Kontakty a online register po P1 | Lokálny aj živý lookup, uloženie bez duplicity, fallback, ceny klienta, spoločná identita dodávateľa | Deduplikácia a oprávnenia |
| P5 | Náklady, banka, import/export, nastavenia po P1–P3 | Rovnaké ovládanie, skutočný nákladový editor, prílohy, alokácie, celý importný scenár | Transakcie a exportné sumy |
| P6 | Expedícia/FMCG po P3 a existujúcej konsolidácii | Mapovanie riadok–šarža, zachované sumy, GLN/ref, max PDF 10 MB, dôkaz dodania | Povinná odborná kontrola návrhu |
| P7 | Peppol odoslanie/príjem po P6 | Validácia, trvalý outbox, retry, idempotentný webhook, reálny príjem/akceptácia 101ky, archív | Silnejší model + externé potvrdenie |
| P8 | Ponuky/objednávky/dodacie listy po P3 | Nadväzné dokumenty s rozsahom konverzie, bez dvojitého fakturovania | Väzby a súbeh |
| P9 | Zálohy/daňové doklady/vyúčtovanie po P3/P5 | Celý reťazec na príkladoch, správna DPH a saldo, storno/vrátenie | Silnejší model + účtovník |
| P10 | Opakovanie, zľavy, meny, hromadné akcie | Jednotlivo špecifikované workflow, idempotencia, zaokrúhlenie, správne PDF/XML | Silnejší model pre finančnú logiku |
| P11 | Prechod a konečná akceptácia | Úplná matica scenárov, import bez duplicít, reconciliácia, záloha/obnova, nasadenie a prevádzkové overenie | Release review |

Prvé spustenie pokrýva domácu faktúru v EUR od výberu odberateľa cez vystavenie a PDF po evidenciu úhrady. Pre tento tok má prednosť register firiem a import bankového výpisu. Tatra Premium API, Peppol pre 101ku a zvyšné dokladové workflow majú vlastné podmienky akceptácie.

## 7. Kontrola výsledku

Pre každú obrazovku uložiť testovací scenár a screenshot z bezpečných syntetických dát. Porovnávať umiestnenie navigácie, hustotu, formulárové kroky a dostupnosť akcií, nielen farbu. Referenčné obrázky neumiestňovať ako grafiku aplikácie. Udržiavať maticu **navrhnuté / implementované / automaticky overené / kliknuté / produkčne overené**; jedna fajka nemá znamenať všetky stavy naraz.

Minimálna akceptačná sada:

1. Prehľad → filter roka/firmy → správny zoznam → detail → späť so zachovanými filtrami.
2. Názov/IČO → lokálna alebo online firma → doplnené údaje → uloženie bez duplicity a bez straty faktúry.
3. Nová faktúra, viac položiek a sadzieb → koncept → úprava → náhľad → kontrola → lokálna finalizácia → PDF/XML so zhodnými sumami.
4. Dve otvorené úpravy, double-click a dvojité joby → jediný zápis alebo zrozumiteľný konflikt.
5. Čiastočná úhrada, preplatok, zrušená alokácia, plný aj čiastočný dobropis → správne saldo a prehľady.
6. Súhrnná faktúra s dvomi objednávkami/dodaniami/šaržami → presné referencie a zachované sumy.
7. Import dvakrát, prijatie rovnakého dokladu dvoma kanálmi → bez tichých duplicít; konflikt viditeľný.
8. Výpadok registra, banky, mailu a Peppolu → uložené dáta zostanú, retry je bezpečný, stav nie je falošne úspešný.
9. Mobil a klávesnica → nič zásadné neprekryté; tlač/PDF má celý doklad; role bez oprávnenia akciu nevykonajú ani priamo.
10. Vystavený doklad po zmene klienta/ceny/profilu zostáva nezmenený; záloha je obnoviteľná.

Tests voliť podľa rizika: výpočty, idempotencia, oprávnenia a databázové väzby automaticky; vizuálne zmeny overiť v prehliadači. Typecheck a build pred odovzdaním. Nenahrádzať vizuálnu kontrolu iba úspešným buildom.

## 8. Presný odovzdávací stav k 22. 11. 2026

- Pracovný adresár: `/Users/macbook/Documents/ERP-finance-2027`, vetva `feat/finance-workspace-ui`, východiskový commit `cfe85d3` nad PR #104.
- P1 má spoločnú hlavičku, záložky agend, prepínač firmy v podporovaných prehľadoch a zozname, kontext prijatých dokladov a akcie podľa roly. Sklad a ostatné agendy používajú pôvodnú navigáciu. Rozpracovaný prehľad, graf, editor a zoznam sú vo vetve zachované.
- Overenie P1 na izolovanom PostgreSQL pokrylo 18 obrazoviek, dostupnosť CSS, aktívnu navigáciu, prenesenie firmy a roka a prístup pre správcu, operátora, sklad a neprihláseného používateľa. V samostatnom okne Chrome prešiel vizuálny a klikací scenár na desktope a pri simulovanej šírke 390 px: prihlásenie operátora, Prehľady, výber Kurgi, otvorenie novej faktúry s predvyplneným vystaviteľom, Náklady, detail prijatého dokladu a návrat so zachovaným výberom firmy. Uloženie konceptu a kontrola na fyzickom mobile neboli súčasťou tohto scenára.
- P2 má kompaktnejšie filtre, stránky po 50 dokladoch a návrat z detailu s pôvodným filtrom a stranou. Náklady počítajú záväzky. Prehľady používajú vystavené EUR doklady bez historických predfaktúr. Cash flow zobrazuje EUR za všetky subjekty. Rozsah a hranice splatnosti sú otestované na izolovanom PostgreSQL. Pri veľkej evidencii ostáva optimalizovať načítanie súm a úhrad pred stránkovaním.
- P3 má súhrn a chyby pri akcii uloženia. Lokálne formulárové požiadavky overili vznik konceptu, úpravu a predvyplnenie kópie s čistými referenciami. Nové rozloženie P2–P3 ešte potrebuje vizuálnu kontrolu. Historický doklad je evidenčný formulár. Nový nákladový editor patrí do P5.
- Existujúce draft PR #96–#104 sú závislý zásobník, nie nasadené zmeny. Ich poradie a dôkazy sú v `FINANCE_2027_GAP_REVIEW.md`. Nemergovať celú vetvu bez kontroly tohto zásobníka a aktuálneho main.
- Oddelená lokálna vetva `feat/invoice-dispatch-batches`, commit `cd530ed`, obsahuje iba základ nullable `StockMovement.orderItemId` a migráciu `20261122090000_dispatch_order_item`. Nie je v UI vetve, nie je nasadená ani kompletná implementácia P6. Pred použitím znovu preveriť.
- `.local-research/` obsahuje prílohu 101ky a extrakcie; necommitovať. Hlavný worktree `/Users/macbook/Documents/ERP-system` obsahuje nesúvisiace zmeny, nezasahovať doň.
- Izolované QA: `/tmp/erp-finance-qa.Scfi5o`, PostgreSQL iba localhost:16631, Next localhost:3008. Súbor `environment.json` je súkromný, nevypisovať. Pred reštartom overiť porty; nikdy nepreberať produkčné DB poverenia do testov.
- P4 má vyhľadávanie podľa názvu aj IČO vo verejnom RPO cez PR #106. Obe formy dopytu boli overené na živom registri. Formulár preberá názov, IČO a sídlo a nechá doplniť DIČ a IČ DPH. Autoform zostáva voliteľný pre širšie predvyplnenie.
- Izolovaný scenár bežnej faktúry prešiel od konceptu s produktom cez vystavenie s číslom a výpočet DPH až po PDF a úhradu z CSV. Opakovaný import nevytvoril druhú platbu. Zhoda pri platbe na účet iného vystavovateľa ostala na manuálnu kontrolu.
- Produkčné overenie k 22. 11. 2026 potvrdilo aktívny daňový profil Kurgi a primárny EUR účet. Z 13 aktívnych produktov nemal žiadny potvrdenú sadzbu k tomuto dátumu. Pred vydaním produktových faktúr treba v nastaveniach zaznamenať účtovníkom potvrdenú sadzbu s dátumom účinnosti pre fakturované produkty. Produkčné vystavovanie je vypnuté.
- Formulár DPH ukladá len označené produkty a pri potvrdení vyžaduje podklad. Lokálne odoslanie formulára overilo, že potvrdenie jedného produktu nezapíše sadzbu druhého. Katalógových 23 % pri `ZS-PAS-KLA-060` treba doložiť zatriedením a potvrdením účinnosti.
- Pre priame načítavanie pohybov cez [Tatra Premium API](https://www.tatrabanka.sk/sk/business/ucty-platby/premium-api-ucty/) treba aktiváciu banky, prístupové údaje a overenie v sandboxe. Pre Peppol treba onboarding poskytovateľa a potvrdenie doručenia od 101ky. Kód oboch integrácií je v stave prípravy.

## 9. Zadanie po prepnutí modelu

> Pokračuj v `/Users/macbook/Documents/ERP-finance-2027` na `feat/finance-workspace-ui`. Prečítaj AGENTS.md, tento blueprint a FINANCE_2027_GAP_REVIEW.md. Najprv skontroluj aktuálny diff; zachovaj rozpracované UI a ostatné worktrees. Dokonči P1, potom P2 a P3 po samostatných kontrolovateľných krokoch. Cieľ je známe rozloženie a workflow SuperFaktúry v žlto-čiernom ERP podľa kapitoly 4, nie len prefarbenie. Testuj na izolovanej DB, over vzhľad aj skutočné kliknutie. Nepovažuj historický náklad za hotový nový editor, neimplementované funkcie za hotové tlačidlá ani sandboxový stav za skutočné doručenie. Nemeň produkčné issuing/sending flags. Každý balík zakonči dôkazmi a aktualizáciou stavu. Pri zmene domény alebo migrácie priprav samostatný malý PR a finančné pravidlá pred implementáciou over. Nové nejasnosti vyrieš najprv z kódu a dokumentácie; bežné kroky znovu nepotvrdzuj.

Odporúčanie modelov je pracovný postup: Sol pre bežnú implementáciu ucelených balíkov; Astra pre návrh a review finančných algoritmov, migrácií, súbehu a Peppolu; Luna len pre presne ohraničené jednoduché úpravy. Konkrétnu spotrebu kreditov nemožno sľúbiť. Kvalitu aj cenu posudzovať podľa hotového overeného balíka, nie ceny jednej odpovede.

## 10. Referencie a súvisiace dokumenty

- [Aktuálne medzery a implementačné dôkazy](FINANCE_2027_GAP_REVIEW.md)
- [Starší doménový a cutover plán](FINANCE_V2_IMPLEMENTATION_PLAN.md) — historické prevádzkové tvrdenia overovať, novembrový stav má prednosť.
- [SuperFaktúra: nový dizajn 2025](https://www.superfaktura.sk/blog/superfaktura-v-novom-superkabate/) — hlavička a hlavná navigácia.
- [SuperFaktúra: prehľady](https://www.superfaktura.sk/blog/prehlady-v-superfakture-fakturacia-aj-cashflow/) — starší referenčný princíp prehľadu, nie dôkaz aktuálneho presného vzhľadu.
- [SuperFaktúra: funkcie](https://www.superfaktura.sk/funkcie/) a [cenové ponuky](https://pomoc.superfaktura.sk/ako-funguju-cenove-ponuky/).
- [OpenAI: modely](https://learn.chatgpt.com/docs/models), [spotreba a voľba lacnejšieho modelu](https://chatgpt.com/codex/pricing/) — overené pri návrhu; nejde o garanciu úspory pre tento projekt.

## Register daňových údajov

- RPO dodá názov, IČO a sídlo. Podľa celého IČO sa doplnia DIČ zo zoznamu registrácií na daň z príjmov a IČ DPH, stav a dátum jeho overenia zo zoznamu registrácií DPH. Údaje z existujúceho kontaktu sa pri vyhľadávaní neprepisujú. Registrácie podľa § 7 a § 7a sa zobrazia oddelene od platiteľov. Bez aktuálneho výpisu sa stav zobrazuje ako neoverený.
- Zdrojom sú [oficiálne exporty Finančnej správy](https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy/exporty-z-online-informacnych). Kompaktné indexy obsahujú iba identifikátory a stav registrácie. Ukladajú sa pod `registry/fs/v1/` v privátnom úložisku. Pred uložením sa overuje dátum, očakávaný rozsah a úplnosť XML. Na vyhľadávanie sa používa výpis starý najviac štyri dni.
- Po nasadení v živom projekte spustiť dennú úlohu `node scripts/refresh-tax-register.mjs` na Railway, napríklad `40 5 * * *` v UTC. Nastaviť `ERP_BASE_URL` na HTTPS adresu aplikácie a `CRON_SECRET` ako referenciu na rovnakú hodnotu vo webovej službe. Úloha končí chybou pri neúspešnej aktualizácii. Výsledok overiť cez vyhľadanie firmy podľa IČO, vrátane odlišných hodnôt DIČ a IČ DPH.
- Overený živý produkčný cieľ je Railway projekt `16793114-d228-43d9-a257-64cbf4007933` podľa záznamu GitHub deploymentu a produkčných adries v README. Projekt `0b9ff77f-cb91-4f59-ac62-388ded748c42` je archív. Pred zápisom alebo nasadením overiť identifikátor cieľa priamo v Railway.

## Dodacie listy v pracovnom prostredí

- Samostatný dodací list alebo list z celej expedovanej objednávky dostane vlastné číslo podľa subjektu a uloží údaje dodávateľa, odberateľa a položky. PDF možno stiahnuť s cenami alebo bez nich. Pohyby skladu eviduje pôvodná expedícia.
- Z detailu alebo výberu v zozname vznikne koncept faktúry. Vybrané dodacie listy musia patriť rovnakému dodávateľovi, odberateľovi a mesiacu dodania. Pri položke bez ceny ju doplní používateľ pred vytvorením konceptu. Konverzia prenáša riadkové referencie do PDF a podkladov Peppol.
- Zrušenie nevystaveného konceptu uvoľní dodacie listy pre nový koncept. Vystavený doklad zostáva evidovaný ako fakturácia dodania aj po storne. Čiastočné dodania z jednej objednávky vyžadujú ďalší samostatný tok.
- Lokálne overenie na PostgreSQL pokrylo migráciu, uloženie cez obe obrazovky, súhrnnú faktúru a presné ceny, ochranu proti súbehu, PDF a podklady UBL.

## Cenové ponuky a pravidelné faktúry

- Cenová ponuka má vlastný číselný rad, dátum platnosti, zmrazené údaje subjektov a ceny. Schválenú ponuku možno bez prepisovania premeniť na objednávku, dodací list alebo koncept faktúry. Objednávka využije existujúci skladový model a vyžaduje produkty s celým množstvom. Zámok na ponuke bráni súbežným nezávislým konverziám toho istého plnenia.
- Z riadnej vystavenej faktúry s úplnými snapshotmi možno vytvoriť dodací list pripojený k pôvodnej faktúre. Ten už patrí k fakturovanému dodaniu a opätovná konverzia na faktúru je blokovaná.
- Plán pravidelnej faktúry má dátum prvého termínu, interval, splatnosť, voliteľný počet konceptov a pozastavenie. Každý termín má práve jeden záznam behu. Po kratšom mesiaci sa opakovanie vráti k pôvodnému dňu. Koncepty využívajú aktuálny daňový profil a nepreberajú referencie zo starého dodania.
- Plán možno spustiť ručne zo zoznamu. Pre denný beh nakonfigurovať autorizovaný POST na `/api/cron/recurring-invoices` s hlavičkou `x-cron-secret` v produkčnom projekte. Úloha vytvára koncepty na kontrolu používateľom.
- Pred uzatvorením zhody bežných dokladov zostáva evidovať zálohu, daňový doklad k prijatej platbe a vyúčtovanie, vrátane čiastočnej a viacnásobnej úhrady. Existujúce historické proformy sú evidenciou importovaného originálu. Banka a Peppol majú samostatné integračné workflow.
