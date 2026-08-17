# Produktový katalóg — zdroje a pracovné daňové údaje

Stav overenia: 17. 8. 2026.

## B2C ceny

Všetky tri príchute majú na `zdravyshot.sk` rovnaké ceny podľa objemu:

| Objem | Koncová B2C cena |
|---:|---:|
| 40 ml | 3,50 € |
| 200 ml | 10,50 € |
| 500 ml | 25,00 € |
| 1000 ml | 45,00 € |

Zdroje:

- <https://www.zdravyshot.sk/produkt/zdravy-shot-zazvor-klasik/>
- <https://www.zdravyshot.sk/produkt/zdravy-shot-zazvor-repa/>
- <https://www.zdravyshot.sk/produkt/zdravy-shot-zazvor-ananas-skorica/>

B2B ceny nie sú globálnou vlastnosťou produktu. Ukladajú sa ku konkrétnemu
B2B klientovi v `ClientProductPrice`; prázdna cena nikdy neznamená nulu.
Po budúcej registrácii DPH treba osobitne rozhodnúť, či tieto verejné koncové
ceny zostanú rovnaké a ERP z nich vypočíta základ dane, alebo sa k dnešným
cenám DPH pripočíta.

## Eurofins a zloženie

| Produkt | Výsledok / receptúra | Zdroj |
|---|---|---|
| Klasik | 12 g cukrov/100 ml; receptúra odoslaná laboratóriu obsahovala 10 % medu | Eurofins `AR-24-SZ-045463-01`, návrh označenia 27. 1. 2025; e-mail „Analýza vzorky“ z 18. 6. 2024 |
| Cvikla | 9,7 g cukrov/100 ml; receptúra odoslaná laboratóriu obsahovala 5 % medu | Eurofins `AR-24-SZ-045462-01`, návrh označenia 27. 1. 2025; e-mail „Analýza vzorky“ z 18. 6. 2024 |
| Ananás a škorica | 14 g cukrov/100 ml (laboratórny výsledok 13,4 g/100 g) | Eurofins `AR-25-SZ-052051-01`; návrh označenia vzorky 67 716 z 15. 7. 2025 |

Celkové cukry z laboratórnej tabuľky nie sú automaticky totožné s množstvom
pridaného cukru na účely zatriedenia DPH. Budúca pracovná sadzba produktu je
23 % podľa pokynu vlastníka, ale aktuálna legacy sadzba v katalógu zostáva 0 %,
aby sa pred registráciou DPH nezvyšovali sumy objednávok. ERP nesmie finalizovať
produkčnú faktúru, kým účtovník
nepotvrdí presný dátum vzniku platiteľstva a časovo platnú sadzbu každého
produktu v `ProductVatRate`.

Oficiálna pomôcka Finančnej správy pre rok 2026 uvádza pri šťavách KN `ex 2009`
5 % iba bez pridaného cukru alebo najviac s 5 g pridaného cukru na 100 ml;
šťavy nad tento limit podliehajú 23 %.

## Registrácia DPH

Oficiálny export Finančnej správy k 17. 8. 2026 eviduje `SK1124908675` ako
registráciu podľa §7a od 1. 3. 2024. To nie je postavenie bežného platiteľa DPH
podľa §4. Október 2026 je iba pracovný odhad budúcej registrácie a bez presného
rozhodnutia sa nezapisuje ako potvrdený daňový profil.
