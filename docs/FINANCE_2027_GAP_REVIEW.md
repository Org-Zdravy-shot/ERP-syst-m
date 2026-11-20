# Fakturácia 2027: Peppol, 101 Drogerie a pracovné postupy SuperFaktúry

Overené 20. 11. 2026 na `origin/main` b45a28e. Toto je implementačný stav, nie potvrdenie produkčnej pripravenosti.

## Pripojenie vlastného ERP

Vlastné ERP môže vytvárať faktúry a používať API certifikovaného digitálneho poštára. ERP nemusí samo prevádzkovať Peppol Access Point. Pred ostrou prevádzkou treba overiť poskytovateľa v registri FS, zmluvu, autorizáciu subjektu, identifikátory, odosielanie, príjem, hlásenia a archív.

- [FS: výber digitálneho poštára, 4. 11. 2026](https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.11.04_navod_digpostar.pdf)
- [FS: FAQ, 19. 11. 2026](https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Zverejnovanie_dok/Aktualne/DPH/2026/2026.11.19_009_DPH_2025_IM_FAQ_eFakt.pdf)
- [Zákon 385/2025, znenie účinné 1. 1. 2027](https://static.slov-lex.sk/pdf/SK/ZZ/2025/385/ZZ_2025_385_20270101.pdf)

Kód obsahuje UBL faktúru/dobropis, klienta eFaktura.sk, validáciu, evidenciu prenosov, podpis webhooku a archív. Chýba preukázaný kompletný odosielací outbox a príjem do agendy. Produkčné premenné sa v tejto práci nemenili ani neoverovali.

**Nové zistenie oproti augustovému plánu:** [úvod providera](https://developers.efaktura.sk/) opisuje test kľúč ako mock doručenie. [Sandbox dokumentácia](https://developers.efaktura.sk/docs/sandbox) zároveň opisuje TEST sieť a schému 9915. Dokumentácia nie je v tomto bode jednotná. Sandbox `delivered` sa preto nesmie považovať za dôkaz prijatia v 101ke. Treba potvrdiť konkrétny testovací kanál s providerom a overiť príjem na strane odberateľa. ID 0245:2020188588 je v e-maile 101ky uvedené ako testovacie; produkčné ID sa nesmie odvodiť iba zo schémy 0245.

## FMCG v1.9

Zdroj: e-mail „e-faktura“ od 101 Drogerie z 19. 11. 2026, príloha `PEPPOL-BIS3.0_SK_FMCG_version_v1.9.xlsx`, verzia z 2. 9. 2026. Príloha bola stiahnutá a všetkých 6 hárkov extrahovaných lokálne. Originál nie je súčasťou Git repozitára.

Ide o využitie existujúcich voliteľných prvkov BIS, nie o vlastné XML tagy mimo štandardu. [Peppol AdditionalItemProperty](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-InvoiceLine/cac-Item/cac-AdditionalItemProperty/) vyžaduje dvojicu Name/Value.

Pridaný generátor podporuje 38 názvov z hárka AdditionalItemProperty A11:A48, GTIN v StandardItemIdentification/ID so schémou 0160 a samostatné údaje pri každom riadku faktúry aj dobropisu. Dátumy sú ISO, GLN/GTIN majú kontrolu číslice, desatinné metadáta zostávajú reťazce. `vat_amount` musí sedieť s už vypočítanou DPH riadku. Poplatky v metadátach nemenia účtovné sumy druhýkrát.

| Požiadavka 101ky | Polia |
|---|---|
| Objednávky oboch strán | buyer_order_number/date, supplier_order_number/date |
| Dodací list a RECADV | delivery_note_number/date, receiving_advice_number/date |
| Miesta | ordered_by_gln, delivery_party_gln, store_number_gln, ultimate_customer_gln |
| Tovar | GTIN, batch_number, expiry_date, delivery_date, item_type Z/O/S |
| Poplatky | recycling_fee_*, copyright_fee_*, excise_duty_* |

Hárok AdditionalItemProperty označuje typy poplatkov num, hlavný mapovací hárok ich opisuje ako text. Kódy sa zachovávajú ako text. Význam a požadované hodnoty pre konkrétne produkty musí potvrdiť odberateľ. Nepoužiteľné údaje sa nevymýšľajú.

**Hranica tejto zmeny:** ide o podporu vstupu UBL generátora. Ešte treba doplniť perzistentné nemenné snapshoty FMCG pri fakturačných riadkoch, formulár a napojenie z objednávok/expedície. Bez toho bežný ERP workflow tieto polia automaticky neposiela. Treba aj súhrnnú fakturáciu viacerých dodaní, štandardné hlavičkové referencie, kontrolu PDF do 10 MB a validačný test BIS + slovenského overlayu + akceptáciu 101ky. Súbežné EDI je alternatíva navrhnutá odberateľom, nie dôkaz existujúceho EDI pripojenia v našom ERP.

## SuperFaktúra: overené pracovné postupy a medzery

Priamo prezreté prihlásené obrazovky účtu Kurgi: prehľad, zoznam faktúr, typy dokladov, platobné filtre, akcie na riadkoch. Nová faktúra bola zablokovaná skončeným členstvom. Používateľ potvrdil skončené členstvo aj pri živnosti. Plná vizuálna/paritná kontrola editorov zatiaľ neprebehla.

| Oblasť | ERP stav a potrebná práca |
|---|---|
| Faktúry a koncepty | Existujú. Doplniť výber firmy podľa názvu/IČO, inline klienta, editovanie konceptu, duplikáciu a kontrolu pred vystavením. |
| Dobropisy | Existujú v doméne. Overiť čiastočné dobropisy, PDF, Peppol a úhrady v E2E. |
| Zálohy a vyúčtovanie | Historická predfaktúra nie je plnohodnotné vystavovanie záloh, daňový doklad k prijatej platbe ani vyúčtovanie. Doplniť celý reťazec. |
| Ponuky a nadväzujúce doklady | Samostatná všeobecná agenda ponúk s platnosťou/schválením a konverziou chýba. Vianočná kalkulačka ju nenahrádza. |
| Objednávky/dodacie listy | Prevádzková agenda existuje. Doplniť spoľahlivé riadkové väzby na faktúry a viac dodaní. |
| Opakované doklady | Predplatné objednávok nie je opakovaná fakturácia. Potrebná samostatná idempotentná plánovaná tvorba. |
| Ceny, zľavy, meny | Presné jednotkové ceny sú podporované. Chýba plná parita zliav na položke/doklade, zahraničných mien a daňových režimov. |
| Náklady | Prijaté/historické doklady a prílohy existujú. OCR a pravidelné náklady chýbajú. |
| Platby | Import výpisov, alokácie a cash-flow existujú. Živé bankové API vyžaduje onboarding. |
| Odoslanie a upomienky | Outbox/mail sú v kóde. Overiť E2E a stav doručenia, prílohy a opakované pokusy. |
| Exporty | Existuje CSV. Plná zhoda s exportmi Omega/Pohoda/Money/MRP/ISDOC/XLSX nie je hotová. |
| Klienti a automatické dopĺňanie | Lokálna databáza klientov existuje. Pripravuje sa spoločné vyhľadávanie + online provider. |
| Prehľady, roly, história | Existujú základy. Overiť rozsah filtrov, hromadné operácie, audit a mobilné rozhranie. |

Referencie: [funkcie](https://www.superfaktura.sk/funkcie/), [ponuky](https://pomoc.superfaktura.sk/ako-funguju-cenove-ponuky/), [koncepty](https://pomoc.superfaktura.sk/koncepty/), [číslovanie](https://pomoc.superfaktura.sk/cislovanie-dokladov/), [zaokrúhľovanie](https://pomoc.superfaktura.sk/faq-zaokruhlovanie/), [Peppol/API poradňa](https://www.superfaktura.sk/blog/efaktura-poradna-4-odpovede-na-vase-otazky/).

Rozhranie má zachovať pracovné postupy, slovenské názvy a žlto-čiernu identitu ERP. Cieľom je funkčná zhoda; úplná zhoda sa nesmie tvrdiť pred akceptačným testom každého workflow.

## Databáza firiem

[Autoform API](https://ekosystem.slovensko.digital/sluzby/autoform/integracny-manual) poskytuje názov/IČO/DIČ/IČ DPH/adresu pre firmy aj SZČO. Vyhľadávanie ide cez server, privátny API kľúč zostáva v `AUTOFORM_API_KEY`. Bez kľúča fungujú uložené ERP kontakty a ručný vstup. [Cenník](https://ekosystem.slovensko.digital/cennik): 9 EUR/mesiac pre 1–255 požiadaviek, 36 EUR pre 256–1000, prvých 30 dní bezplatne; aktuálne podmienky overiť pri registrácii. Predplatné ani účet sa v tejto práci nezakladali.

ORSF inzeruje bezplatné verejné API, ale oba pokusy o search/detail v tomto prostredí vrátili HTTP 403. Nie je preto overenou prevádzkovou náhradou. Zodpovedajúce [API](https://orsf.sk/api) a [pravidlá](https://www.orsf.sk/legal/aup) tiež obsahujú rozdielne tvrdenia o autentifikácii/limitoch.

## Podmienky januárového prechodu

1. Dokončiť dátový model dokladov a FMCG, zachovať čísla, presné ceny a nemennosť.
2. Doplniť pracovné funkcie a import posledných dokladov zo SuperFaktúry bez duplikátov.
3. Pripojiť providera; oddelene otestovať validáciu, skutočné doručenie, príjem a reporting.
4. S 101kou overiť súhrnnú faktúru s dvomi objednávkami, dodaniami a šaržami, aj dobropis. Vyžiadať potvrdenie riadkového párovania.
5. Overiť firemné/daňové profily samostatne pre Kurgi a živnosť, rady 2027, úhrady, archív, zálohu a obnovu. Prechod je podmienený týmito výsledkami, nie samotným dátumom.
