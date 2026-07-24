# Omega import

Jednorazová migrácia načíta pôvodný `export.zip` alebo priamo `omega.txt`,
dekóduje Windows-1250 a validuje partnerov, faktúry, položky, sumy a číselný
rad. Reálny export ani jeho rozbalený obsah nepatria do Gitu.

Dry-run je bez databázových zápisov:

```sh
npm run finance:omega -- /bezpecna/cesta/export.zip
```

Výstup obsahuje SHA-256. Produkčný commit sa odomkne iba vtedy, keď operátor
zopakuje rovnaký hash a uvedie referenciu už overenej databázovej zálohy:

```sh
npm run finance:omega -- /bezpecna/cesta/export.zip \
  --commit \
  --confirm-sha256=<sha-z-dry-runu> \
  --backup-reference=<id-zalohy> \
  --actor-id=<id-admina> \
  --actor-email=<email-admina> \
  --mark-issued-paid \
  --issued-paid-date=due-date
```

`--issued-paid-date=due-date` je vedomá migračná stratégia. Omega export pri
historických vydaných faktúrach neobsahuje dátumy úhrad, hoci ich vlastník
potvrdil ako uhradené. Import preto vytvorí auditovanú manuálnu platbu k dátumu
splatnosti a túto skutočnosť uloží do poznámky platby aj auditu.

Celý commit prebieha v jednej databázovej transakcii. Pred zápisom sa kontrolujú
kolízie čísel aj externých ID, platný firemný a daňový profil a existujúci
číselný rad. Rovnaký súbor je idempotentný cez `ImportBatch(source, sha256,
mode)`.
