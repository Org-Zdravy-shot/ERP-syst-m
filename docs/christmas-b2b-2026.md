# Vianočná B2B kampaň 2026

Modul je samostatný od štandardných `Order`, `Invoice` a budúcej internej nákladovej kalkulačky. Používa spoločný záznam klienta, no všetky finančné položky a snapshoty sú v tabuľkách `christmas_*`. Prístup je obmedzený existujúcimi finančnými rolami a kampaňami právneho subjektu `KURGI`.

## Použitie

1. Finančný administrátor založí kampaň 2026 na `/vianocna-b2b`.
2. Pri vytvorení kalkulácie vyberie firemného klienta, pôvod leadu, shoty, balenia a objednávkové náklady. Rozpracovanú kalkuláciu možno uložiť s neznámymi nákladmi.
3. Pri prechode do schválenej ponuky musia byť ceny, náklady a pôvod kompletné. Ďalšie stavy sú odoslaná ponuka, potvrdená objednávka, fakturovaná a zaplatená. Fakturácia a úhrada sú manuálne označované s referenciou, modul nič neodosiela ani neplatí.
4. Zmena master vstupov vytvorí novú verziu. Staré snapshoty sa nemenia. Výslovný prepočet aktuálnych nákladov vytvorí novú revíziu a ponechá pôvodnú cenu a receptúru.
5. Dodatočná reklama sa eviduje osobitne a priradí najviac jednej objednávke. Nepriradená reklama sa odpočítava iba v súhrne kampane. Chybný reklamný zápis možno auditovane zrušiť.
6. Po potvrdenom skončení kampane možno nemenne uzavrieť vyúčtovanie zaplatených a nevrátených agentúrnych zákaziek. Uzavretie nespúšťa platbu.

## Výpočty

Výpočtový engine je v `src/lib/christmas/engine.ts` a používa `Prisma.Decimal`. Jednotkové cenníkové ceny sú schválené dvojdesatinné hodnoty; produkčné náklady sa počítajú z receptúry, výťažností, DPH režimu, 2 % straty surovín, obalov, pasterizácie a fixnej réžie 1 591,95 € / 150 l. Do réžie patrí 100 € vlastného marketingu. Agentúrna reklama do deliteľného zisku nevstupuje. Kladný zisk agentúrnej objednávky sa delí 50/50, pri vlastnom zákazníkovi 100/0 a pri neoverenom pôvode zostáva nealokovaný.

## Migrácia a overenie

Migrácia: `prisma/migrations/20261102180000_christmas_campaign/migration.sql`. Pred nasadením použiť bežný proces projektu `npm run db:deploy` s platnou zálohou a pripojením. Migračný SQL bol aplikovaný na izolovanú lokálnu databázu s pôvodnou schémou; následný `prisma migrate diff` neukázal rozdiel oproti novej schéme.

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- Integračné testy sa spustia iba s `CHRISTMAS_TEST_DATABASE_URL` smerujúcim na databázu `christmas_test_*` alebo lokálny PGlite testovací port 55433/55434. Schému treba pripraviť pred testom. Pri opakovanom behu na PGlite použiť v URL `?pgbouncer=true`, aby sa nevracali pripravené SQL príkazy z predchádzajúceho spojenia. Bez tejto premennej sa integračné testy preskočia.

## Otvorené účtovné a technické údaje

- Skutočný dátum konca kampane sa zadáva v administrácii; bez neho sa vyúčtovanie neuzavrie.
- Kompatibilita uzáveru 6654T s 200 ml fľašou nie je potvrdená, cena vo výpočte zostáva schválená.
- Daňová klasifikácia a sadzba prípadnej dane zo sladených nápojov nie sú potvrdené. Daň sa automaticky neúčtuje. Ak administrátor označí daň za uplatniteľnú, finalizácia nových zákaziek sa zablokuje do doplnenia schválenej daňovej logiky.
- Daňové postavenie agentúry a DPH jej faktúry nie sú súčasťou podielu na zisku.
- Úhrady a refundácie sú v tomto module manuálne evidované s referenciou. Nie sú automaticky synchronizované s bankou ani existujúcimi faktúrami ERP.
