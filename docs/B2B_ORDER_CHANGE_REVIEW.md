# B2B objednávky: kontrola zmeny (24. 10. 2026)

## Zistenie v aktuálnom ERP

- Živý formulár Gleistein má prázdneho klienta a produkt, ale ponechal množstvo 150 a cenu `1,827`. Zobrazuje nulu a hlásenie „Pridajte aspoň jednu položku“.
- Pôvodný formulár používal parser na najviac dva desatinné znaky. Neplatný riadok pred odoslaním odstránil zo JSON a server potom videl prázdny zoznam.
- Ceny v objednávke sa v aktuálnom kóde načítavajú so stránkou, nie ďalším asynchrónnym volaním. Zmena klienta alebo dátumu však vždy prepisovala cenu. Odkaz na vytvorenie produktu prenášal späť iba klienta a inbox, takže ostatné polia sa po návrate resetovali.
- Produkčné `OBJ2026-0001` (Descanti) má 100 ks za `1,32 €` bez DPH, základ `132,00 €`, DPH `30,36 €`, spolu `162,36 €`. Trvanlivosť do `31. 5. 2027` je v poznámke. Objednávku sme nemenili.
- Pasterizovaný shot `ZS-PAS-KLA-060` má v katalógu B2C hodnotu `2,50 €`, prázdnu predvolenú B2B cenu a všeobecnú trvanlivosť `220` dní. Gleistein nemá uloženú individuálnu B2B cenu ani objednávku. Význam existujúcich B2C súm mimo výpočtu objednávky nie je potvrdený; žiadna suma v katalógu ani cenníku sa touto zmenou neprepisuje.

## Navrhnuté správanie

- Nová objednávka Gleistein: 150 ks × `1,8270 €` bez DPH; základ `274,05 €`, DPH 23 % `63,03 €`, spolu `337,08 €`.
- Cena položky sa ukladá ako `DECIMAL(18,4)`. Historická centová cena zostáva nedotknutá; pri nových položkách je aj centový snapshot pre staršie integrácie, ale základ sa počíta z presnej ceny.
- Ručná cena sa vzťahuje iba na objednávku. Zmena klienta alebo preferovaného dátumu dodania obnoví len automatické ceny. Pri tvorbe produktu alebo návrate z nej sa koncept v prehliadači obnoví a nový produkt sa vyberie.
- Požadovaná minimálna exspirácia je údaj položky objednávky. Skutočná exspirácia je na pridelenej výrobnej šarži. Expedícia sa odmietne, ak šarže požiadavku nespĺňajú alebo sa pri historických pohyboch bez šarže nedá exspirácia spoľahlivo doložiť.
- Doplnené sú preferované a najneskoršie dodanie, dodacia adresa a kontakt, spôsob úhrady vrátane „Nedohodnuté“ a splatnosť faktúry. Pred uložením sa zobrazí súhrn; po uložení číslo objednávky.

## Hranice overenia

- Lokálne prešli typy, zostavenie aplikácie a automatické testy presnej ceny, zaokrúhlenia, uloženia dát objednávky cez serverovú akciu, opätovného zobrazenia ceny, návratu z tvorby produktu, ochrany ručnej ceny, šarží a elektronickej faktúry.
- Nebola vykonaná produkčná migrácia, nasadenie ani skúšobná produkčná objednávka Gleistein. Pred nasadením treba skontrolovať migráciu, vytvoriť zálohu databázy a po nasadení otestovať formulár bez jeho odoslania, detail Descanti a fakturačný koncept na bezpečných testovacích dátach.
