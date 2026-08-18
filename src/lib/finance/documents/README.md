# Financie v2 — dokumenty

Implementácia developera B pre nemenné fakturačné PDF a privátne dokumenty.

## Vlastnosti

- slovenská faktúra alebo dobropis s rozpisom DPH;
- platobné údaje a slovenský PAY by square QR kód;
- slovenská diakritika cez lokálne Noto Sans TTF fonty;
- SHA-256 nad finálnymi PDF bajtmi;
- obsahovo adresovaný objektový kľúč
  `finance/invoices/<invoiceId>/<sha256>.pdf`;
- zápis do privátneho S3-kompatibilného Railway Bucketu s
  `If-None-Match: *`;
- autorizovaný download cez ERP bez verejnej bucket URL;
- kontrola SHA-256 pred každým downloadom;
- audit `DOCUMENT_DOWNLOADED`.
- nemenné PDF/JPG/PNG prílohy prijatých faktúr do 10 MB;
- kontrola skutočného typu súboru podľa binárnej hlavičky, bezpečný názov a
  audit `DOCUMENT_ATTACHMENT_STORED`.

PDF je možné vytvoriť iba pre vydaný a finalizovaný doklad s nemennými
snapshotmi dodávateľa, odberateľa, dane a položiek.

## API

- `POST /api/financie/faktury/:id/dokumenty` — vygeneruje a uloží PDF;
- `POST /api/financie/faktury/:id/dokumenty?typ=priloha` — uloží raw telo
  požiadavky ako prílohu prijatej faktúry; URL-encoded názov očakáva v hlavičke
  `X-File-Name-Encoded`;
- `GET /api/financie/dokumenty/:id` — overí integritu, zapíše audit a vráti
  súbor ako `attachment`.

Obe route vyžadujú aktuálneho databázového používateľa s príslušným finančným
oprávnením: `VIEW` pre download a `CREATE_DRAFT` pre vytvorenie PDF.

## Railway Bucket

Nastavte referenčné premenné:

```text
DOCUMENT_BUCKET_NAME
DOCUMENT_BUCKET_ENDPOINT
DOCUMENT_BUCKET_REGION
DOCUMENT_BUCKET_URL_STYLE=virtual
DOCUMENT_BUCKET_ACCESS_KEY_ID
DOCUMENT_BUCKET_SECRET_ACCESS_KEY
```

Bucket musí zostať privátny. Prístupové údaje patria iba do Railway variables,
nikdy do Gitu. Aktuálne Railway Buckety používajú
`DOCUMENT_BUCKET_URL_STYLE=virtual`; hodnotu `path` použite iba pre staršie
alebo iné S3-kompatibilné úložisko, ktoré ju výslovne vyžaduje.

## Testy

```bash
npm test
npm run typecheck
```

Testy pokrývajú PAY by square údaje, deterministické a viacstranové PDF,
dobropisy, DPH snapshoty, podmienený S3 zápis, idempotentné uloženie, hash,
tampering a audit downloadu.
