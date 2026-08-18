# Dodávatelia — produktový a implementačný plán

> Stav dokumentu: návrh schválený na implementáciu 18. augusta 2026.
> Modul sa dodáva po malých PR; existujúce financie, sklad a faktúry zostávajú
> počas nasadzovania funkčné.

## Cieľ

ERP bude jediným pracovným miestom pre evidenciu dodávateľov, ich kontaktov,
prevádzok, ponúk a cien, nákupov, záväzkov, vratných obalov a doobjednávania
zásob. Používateľ má na profile dodávateľa okamžite vidieť:

- kto dodávateľ je, odkiaľ ho poznáme a koho kontaktovať;
- čo od neho vieme kúpiť, za akú cenu, v akom balení a s akou dodacou dobou;
- koľko a za koľko sme od neho historicky nakúpili;
- otvorené nákupné objednávky a prijaté dodávky;
- neuhradené prijaté faktúry a ostatné vzájomné finančné záväzky;
- ktoré vratné nádoby, palety alebo obaly držíme my a ktoré drží dodávateľ;
- či je potrebné niečo doobjednať a ktorý dodávateľ je pre položku preferovaný.

Prvá verzia podporuje EUR a slovenské nákupy. Systém môže automaticky vytvoriť
návrh objednávky, ale nič neodošle dodávateľovi bez vedomého potvrdenia
používateľa.

## Zásady dátového modelu

### Jeden dodávateľ, viac kontaktov a miest

Dodávateľ má právne a daňové údaje, zdroj kontaktu, internú poznámku a stav.
Samostatné záznamy uchovávajú:

- kontaktné osoby s rolou, telefónom a e-mailom;
- sídlo, sklad, miesto osobného odberu, fakturačnú alebo inú adresu;
- viac bankových účtov;
- voľné štítky pre segmentáciu, napríklad `med`, `ovocie`, `obaly`.

Dodávateľ sa nemaže, iba deaktivuje. História objednávok, dokladov, cien a
pohybov tak nikdy nestratí význam.

### Viac dodávateľov a viac ponúk na jednu položku

Ponuka dodávateľa môže byť naviazaná na surovinu, hotový produkt alebo môže
zostať ako nenaskladňovaná služba. Obsahuje dodávateľské SKU, názov, jednotku,
veľkosť balenia, minimálny odber, násobok objednávky, dodaciu dobu, pôvod a
poznámku ku kvalite.

Ceny sú samostatná časová história. Cena má platnosť, množstevnú hranicu,
informáciu netto/brutto, DPH a menu. Stará cena sa neprepíše; uzatvorí sa jej
platnosť a vznikne nová. Historická objednávka vždy drží snapshot svojej ceny.

Pre jednu skladovú položku môže byť preferovaná konkrétna ponuka. Ak chýba,
systém zobrazí alternatívy, ale dodávateľa sám neuhádne.

### Nákupné objednávky a príjem

Nákupná objednávka má samostatný rad `NO2026xxx` a workflow:

`DRAFT → APPROVED → SENT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`

Z každého stavu možno objednávku za povolených podmienok zrušiť. Odoslaná
objednávka uchová snapshot dodávateľa, miesta dodania, položiek a cien.

Príjem môže byť čiastočný a na viac dodacích listov. Každá prijatá skladová
položka vytvorí práve jeden kladný pohyb v skladovom ledgeri. Opakované
odoslanie formulára nesmie vytvoriť druhý príjem. Prebraté množstvo sa počíta z
príjmov, nie z ručne meneného príznaku.

### Vratné obaly a nádoby

Vratné obaly sú samostatný pohybový ledger. Typ obalu určuje vlastníka:

- `SUPPLIER` — obal patrí dodávateľovi a pri kladnom zostatku ho držíme my;
- `COMPANY` — obal patrí nám a pri kladnom zostatku ho drží dodávateľ.

Kladný pohyb zvyšuje nevyriešený počet, záporný zaznamenáva vrátenie. Zostatok
je vždy súčet pohybov. Typ môže mať depozit, obvyklú lehotu vrátenia a
pripomienku. Takto možno evidovať aj nádoby na med držané dlhšie než rok bez
prepisovania minulosti.

### Peniaze a záväzky

Bežný záväzok sa počíta z prijatých faktúr priradených dodávateľovi mínus
aktívne platobné alokácie. Dobropis sa započíta opačným znamienkom.

Ostatné dohody, depozity, zápočty a počiatočné stavy sú v samostatnom
finančnom ledgeri:

- kladná suma znamená, že dlžíme dodávateľovi;
- záporná suma znamená, že dodávateľ dlží nám.

Ručný finančný ledger smie meniť iba finančný administrátor a každá zmena sa
audituje. Faktúry ani platby sa doň nekopírujú, aby sa suma nezapočítala dvakrát.

## Doobjednávanie zásob

Surovina alebo nakupovaný produkt môže mať minimálnu a cieľovú zásobu.
Odporúčanie vznikne, keď disponibilný stav klesne pod minimum:

1. od cieľového množstva sa odpočíta aktuálny stav a už objednané neprijaté
   množstvo;
2. výsledok sa zaokrúhli na balenie a násobok objednávky;
3. rešpektuje sa minimálny odber a aktívna cena;
4. použije sa preferovaná ponuka alebo sa vyžiada výber z alternatív;
5. položky rovnakého dodávateľa sa spoja do jedného konceptu objednávky.

Negatívny stav, chýbajúca cena, neaktívny dodávateľ alebo nejednoznačná
preferovaná ponuka sa zobrazia na manuálnu kontrolu. Automat nikdy nezvolí
neoverenú cenu ani neodošle objednávku.

## Bezpečnosť a audit

- všetky mutácie znova overia prihláseného používateľa na serveri;
- ceny, IBAN, fakturačné zostatky a manuálny finančný ledger sú dostupné iba
  rolám s finančným oprávnením;
- vytvorenie a zmena dodávateľa, ceny, objednávky, príjmu, záväzku a vratného
  pohybu vytvára auditný záznam;
- záznamy sa archivujú/deaktivujú, účtovná a skladová história sa nemaže;
- peniaze sú vždy celé centy, množstvá používajú existujúce skladové jednotky;
- DB kontroly odmietnu nulové ledger pohyby, záporné ceny a položku súčasne
  naviazanú na surovinu aj produkt.

## Obrazovky

### `/dodavatelia`

Vyhľadávanie podľa názvu, IČO, kontaktu, mesta, štítku a zdroja. Karty hore
zobrazia aktívnych dodávateľov, otvorené objednávky, neuhradené záväzky a
vratné obaly. Zoznam zvýrazní dodávateľov s omeškanou dodávkou alebo obalom.

### `/dodavatelia/[id]`

Profil obsahuje súhrn, kontakty, lokality s odkazom na mapu, bankové účty,
ponuky a históriu cien, nákupnú históriu, faktúry, finančný zostatok, vratné
obaly, objednávky, dodávky a auditnú časovú os. Najčastejšie úkony sú priamo na
profile a nevyžadujú prechod do nastavení.

### `/dodavatelia/objednavky`

Koncepty, odoslané a čiastočne prijaté objednávky, termíny, sumy a rýchly
príjem dodacieho listu. Detail ukazuje objednané, prijaté a zostávajúce
množstvo po každom riadku.

### `/dodavatelia/doobjednanie`

Interaktívny zoznam nízkych zásob s vysvetlením výpočtu, alternatívnymi
dodávateľmi, cenou a očakávaným termínom. Používateľ môže upraviť množstvo a
jedným potvrdením vytvoriť koncepty objednávok rozdelené podľa dodávateľa.

## Etapy implementácie

### S0 — doména a migrácia

- [x] dodávateľ, kontakty, lokality, účty a štítky;
- [x] katalóg dodávateľa a časová história cien;
- [x] nákupné objednávky, riadky a čiastočné príjmy;
- [x] finančný a vratný ledger;
- [x] väzba prijatej faktúry a skladového pohybu na dodávateľa;
- [x] cieľová zásoba, validačné schémy, výpočty a testy.

### S1 — adresár a profil

- [x] navigácia, zoznam, vyhľadávanie, vytvorenie a editácia;
- [x] kontakty, lokality, bankové účty a štítky;
- [x] ponuky, ceny, preferovaný dodávateľ a história;
- [x] vratné obaly a ostatný finančný ledger;
- [x] súhrn histórie, faktúr a audit.

### S2 — objednávanie a sklad

- [x] nákupná objednávka a povolené stavové prechody;
- [x] čiastočný príjem s idempotentným skladovým pohybom;
- [x] automatický prepočet stavu a poslednej nákupnej ceny;
- [x] low-stock odporúčania a vytvorenie konceptov podľa dodávateľa;
- [x] integračné a E2E testy (izolovaný DB flow dodávateľ → objednávka → dva príjmy → sklad → vratný obal → idempotencia).

### S3 — riadená automatizácia

- [ ] PDF/e-mail nákupnej objednávky cez existujúci outbox;
- [ ] pripomienky omeškaných dodávok a vratných obalov;
- [ ] metriky dodávateľa: cena, spoľahlivosť, dodacia doba a reklamácie;
- [ ] voliteľné pravidelné vytváranie konceptov objednávok;
- [ ] import cenníkov a potvrdení objednávok.

## Akceptačné scenáre

- jedna surovina má dvoch dodávateľov a dve odlišné aktívne ceny;
- zmena ceny neprepíše starú nákupnú objednávku;
- príjem polovice objednávky vytvorí skladový pohyb a stav
  `PARTIALLY_RECEIVED`; druhý príjem ju uzavrie;
- opakovaný príjem toho istého riadku nevytvorí duplicitný pohyb;
- nádoby na med majú po prevzatí kladný zostatok a po vrátení nulu;
- opačne vlastnený obal správne ukáže, že ho dlží dodávateľ nám;
- prijatá faktúra 100 € s platbou 40 € ukáže záväzok 60 €;
- záporný manuálny zostatok sa zobrazí ako pohľadávka voči dodávateľovi;
- nízky sklad odpočíta už objednané množstvo a nevytvorí dvojitú objednávku;
- nefinančná rola nevidí ceny, IBAN ani finančné zostatky;
- deaktivovaný dodávateľ sa neponúkne do novej objednávky, história zostane.

## Poznačené úlohy po dodávateľskom module

Po dokončení modulu sa pokračuje bodmi, ktoré používateľ výslovne odložil:

1. výber a integrácia certifikovaného eFaktúra poskytovateľa;
2. písomné potvrdenie dátumu a sadzieb DPH účtovníkom;
3. aktivácia Tatra Premium API a sandbox;
4. produkčná aktivácia Resend/DKIM evidovaná v
   [issue #29](https://github.com/Org-Zdravy-shot/ERP-syst-m/issues/29).
