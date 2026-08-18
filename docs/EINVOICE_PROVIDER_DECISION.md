# eFaktúra — rozhodnutie o poskytovateľovi a sandbox

Aktualizované: 18. augusta 2026

## Rozhodnutie

Pre sandbox integráciu volíme **eFaktura.sk**, certifikovaný PDS s identifikátorom
`EFSK000028`. Pred produkčným zapnutím ešte potvrdíme zmluvné podmienky a cenu
pre jednu firmu s vlastným ERP.

Dôvody výberu:

- je v oficiálnom zozname certifikovaných poskytovateľov Finančnej správy;
- má verejne zdokumentované REST API, reálnu Peppol TEST sieť a testovacie kľúče;
- podporuje odosielanie vlastného UBL XML, príjem dokladov, stavy, dôkaz o
  doručení, webhooky a idempotenciu;
- sandbox nečerpá kredity a produkciu odlišuje prefix API kľúča.

Referencie:

- [Finančná správa — eFaktúra](https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty/e-faktura)
- [Finančná správa — výber poskytovateľa](https://vpds.financnasprava.sk/)
- [eFaktura.sk — rýchly štart](https://developers.efaktura.sk/docs/quickstart)
- [eFaktura.sk — connector](https://developers.efaktura.sk/docs/connector)
- [eFaktura.sk — prijímanie a stavy](https://developers.efaktura.sk/docs/receiving)
- [eFaktura.sk — webhooky](https://developers.efaktura.sk/docs/webhooks)

## Architektúra

ERP zostáva jediným zdrojom čísla, snapshotu a účtovného obsahu faktúry.
Nepoužijeme provider endpoint, ktorý by vystavoval faktúru a prideľoval jej
číslo. Tok bude:

1. ERP finalizuje nemennú faktúru a pridelí jej číslo.
2. ERP vygeneruje Peppol BIS Billing 3.0 UBL XML zo snapshotu.
3. XML sa najprv odošle connectorom s `validateOnly=true`.
4. Po úspešnej validácii ho outbox odošle s `dispatch=now`, `autoRepair=false`
   a stabilným `Idempotency-Key` odvodeným od ID faktúry a hash-u XML.
5. Stav sa aktualizuje webhookom; polling slúži ako poistka.
6. Prijaté doklady sa načítajú z autoritatívneho zoznamu providera a pôvodné
   UBL XML sa nemenne archivuje s hashom.

`autoRepair` zostáva vypnuté, aby poskytovateľ bez vedomia ERP nemenil oficiálny
obsah dokladu. Ak validátor navrhne opravu, ERP ju zobrazí na kontrolu.

## Bezpečnostné brány

- `EINVOICE_ENABLED=0` je predvolený stav.
- Sandbox používa iba kľúč s prefixom `efk_pk_test_`.
- Kľúč `efk_pk_live_` kód odmietne, kým nie sú súčasne zapnuté
  `EINVOICE_LIVE_ENABLED=1` a `FINANCE_PRODUCTION_ISSUING_ENABLED=true`.
- API kľúč, organization ID a webhook secret patria iba do Railway variables.
- Webhook sa overuje HMAC-SHA256 nad presným raw telom, s toleranciou 300 sekúnd;
  udalosti sa budú deduplikovať podľa `X-Webhook-Id`.

## Stav implementácie

- [x] výber kandidáta a architektonické rozhodnutie;
- [x] fail-closed konfigurácia sandbox/live;
- [x] connector klient pre vlastné UBL, idempotenciu a validačný režim;
- [x] čítanie stavov, stránkovanie prijatých dokladov a stiahnutie XML;
- [x] overenie webhook podpisu vrátane rotácie secretu a replay ochrany;
- [ ] sandbox účet, testovací API kľúč, organizácia a Peppol TEST enroll;
- [x] deterministický generátor Peppol BIS Billing 3.0 UBL pre slovenskú
  faktúru a dobropis (centy, DPH skupiny, jednotky, XML escaping, hash);
- [ ] overenie generovaného UBL proti slovenskému FS overlayu v sandboxe;
- [ ] DB evidencia prenosov, prijatých dokladov a webhook deduplikácie;
- [ ] outbox, webhook route, administračná obrazovka a end-to-end sandbox test;
- [ ] produkčná zmluva, autorizácia poskytovateľa vo Finančnej správe a live gate.

## Údaje, ktoré bude musieť dodať vlastník účtu

Po vytvorení sandbox účtu sa do Railway vložia:

```text
EINVOICE_ENABLED=1
EINVOICE_LIVE_ENABLED=0
EFAKTURA_API_KEY=efk_pk_test_...
EFAKTURA_ORGANIZATION_ID=...
EFAKTURA_WEBHOOK_SECRET=...
```

Kľúče sa neposielajú do chatu ani do GitHub issue. Zadajú sa priamo ako Railway
variables. Produkčnú registráciu a platený plán nevytvárame bez potvrdenia
vlastníka.
