# WooCommerce → ERP objednávky

Endpoint: `POST /api/woocommerce/orders` na kanonickej ERP doméne.

WooCommerce webhooky: témy **Order created** a **Order updated**, oba s tým istým náhodným tajomstvom. V ERP sa nastaví `WOOCOMMERCE_WEBHOOK_SECRET` (aspoň 32 znakov). Endpoint overuje HMAC-SHA256 z pôvodného tela cez `X-WC-Webhook-Signature`. Bez premennej vracia 503; neoverené požiadavky 401. [WooCommerce dokumentácia](https://developer.woocommerce.com/docs/apis/rest-api/v2/webhooks)

Po bezpečnom nasadení migrácie a aplikácie treba nastaviť oba webhooky v obchode, poslať skúšobnú objednávku a skontrolovať `/objednavky/synchronizacia`. WooCommerce po viacerých neúspešných doručeniach môže webhook vypnúť; kontrolujte log doručenia v obchode.

ERP priradí produkty podľa SKU. Prevezme len objednávku v EUR, pri ktorej produkty, doprava a poplatky presne reprodukujú netto cenu, DPH a celkovú sumu. Doprava a poplatky sú samostatné riadky bez skladového produktu a prenesú sa aj do konceptu faktúry. Nejednoznačná alebo nezhodná DPH, chýbajúce SKU a firemný klient bez zhodného e-mailu vytvoria záznam „Skontrolovať“ bez neúplnej ERP objednávky. Zmeny po vystavení faktúry, sklade alebo expedícii neprepíšu ERP dáta. Woo ID je jedinečné a opakovaný webhook nevytvorí ďalšiu objednávku.

Táto integrácia nevytvára faktúry, neodosiela objednávky späť do WooCommerce a nezaúčtúva platby. Po nasadení ostáva nutné samostatne overiť mapovanie produktov, dopravy a dokladov na reálnom vzorku pred tým, ako sa použije ako jediný zdroj prevádzkových objednávok.
