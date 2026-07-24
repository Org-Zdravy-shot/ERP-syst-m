# Financie v2 — e-mail, outbox a upomienky (Dev E)

Odosielanie faktúr/dobropisov e-mailom, spracovanie outbox udalostí a upomienky
po splatnosti. Stojí na Dev B `DocumentService` (PDF) a Dev A kontraktoch
(`MailProvider`, `OutboxEvent`, `EmailDelivery`).

## Tok

```
finalize() ──(už existuje)──▶ OutboxEvent INVOICE_PDF
                                      │  outbox worker (/api/cron/outbox)
                                      ▼
                        DocumentService.generateAndStoreInvoicePdf  (Dev B)
                                      │  ak VYDANA + klient má e-mail
                                      ▼
                              OutboxEvent INVOICE_EMAIL
                                      │
                                      ▼
                    MailProvider.send + EmailDelivery (SENT/FAILED)
```

Upomienky: `/api/cron/reminders` zaradí `REMINDER_EMAIL` pre vydané, neuhradené
faktúry po splatnosti (zostatok zo súčtu aktívnych alokácií, legacy `UHRADENA`
sa rešpektuje) — max jedna za týždeň na faktúru.

## Idempotencia a spoľahlivosť

- `OutboxEvent.idempotencyKey` (unique) — udalosť sa nezaradí dvakrát.
- Worker atomicky uchmatne udalosť (PENDING→PROCESSING, `updateMany` count===1).
- Retry s exponenciálnym backoffom (`decideRetry`), po `MAIL_MAX_ATTEMPTS` → FAILED.
- `NonRetryableError` (napr. klient bez e-mailu) → FAILED bez opakovania.
- `EmailDelivery` idempotentné podľa `outboxEventId`; ak už SENT, neodosiela znova.
- PDF je content-addressed (Dev B) — resend nevytvorí nový dokument.

## Provider

Vendor-neutrálne cez SMTP (`SmtpMailProvider`, nodemailer). Bez nakonfigurovaného
SMTP beží `LogMailProvider` (dev/E2E — zaznamená, neodošle). Delivery/bounce cez
webhook je vec 2. etapy; SMTP dáva SENT/FAILED.

Odosielateľ: `info@zdravyshot.sk` (`MAIL_FROM`). Tajomstvá len v Railway variables.

## Cron (Railway)

- `POST /api/cron/outbox` (x-cron-secret) — každých ~5 min.
- `POST /api/cron/reminders` (x-cron-secret) — denne ráno.

## Konfigurácia (.env)

```text
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
MAIL_FROM=info@zdravyshot.sk, MAIL_REPLY_TO, MAIL_FROM_NAME
REMINDER_GRACE_DAYS=3
CRON_SECRET=<openssl rand -hex 32>
```

Bez `DOCUMENT_BUCKET_*` beží lokálne úložisko `.local-bucket/` (dev fallback);
produkcia používa privátny Railway Bucket cez Dev B `S3DocumentStorage`.

## Testy

`npm test` — retry politika/backoff, šablóny (SK obsah), Log provider.
Celý reťazec (finalize → outbox → PDF → EmailDelivery SENT) overený E2E na
lokálnom Postgrese + `.local-bucket` + LogMailProvider.
