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
faktúry po splatnosti. Stav aj zostávajúca suma sa počítajú výhradne z
aktívnych alokácií — max jedna upomienka za týždeň na faktúru.

## Idempotencia a spoľahlivosť

- `OutboxEvent.idempotencyKey` (unique) — udalosť sa nezaradí dvakrát.
- Worker atomicky uchmatne udalosť (PENDING→PROCESSING, `updateMany` count===1).
- Zaseknutý PROCESSING zámok sa po 15 minútach bezpečne obnoví alebo ukončí.
- Retry s exponenciálnym backoffom (`decideRetry`), po `MAIL_MAX_ATTEMPTS` → FAILED.
- `NonRetryableError` (napr. klient bez e-mailu) → FAILED bez opakovania.
- `EmailDelivery` idempotentné podľa `outboxEventId`; ak už SENT, neodosiela znova.
- PDF je content-addressed (Dev B) — resend nevytvorí nový dokument.

## Provider

Doména používa vendor-neutrálne rozhranie `MailProvider`. Railway Hobby
blokuje odchádzajúce SMTP, preto produkcia používa `ResendMailProvider` cez
HTTPS API; `SmtpMailProvider` (nodemailer) ostáva fallbackom pre Railway Pro
alebo inú infraštruktúru. Bez platnej konfigurácie beží `LogMailProvider` iba
v dev/teste a produkcia zlyhá bezpečne. Delivery/bounce webhooky sú samostatná
etapa; prijatie API/SMTP providerom zatiaľ znamená stav SENT.

Odosielateľ: `info@zdravyshot.sk` (`MAIL_FROM`). DKIM musí byť potvrdený pred
produkčným vystavovaním. Tajomstvá patria len do Railway variables.

## Cron (Railway)

- `POST /api/cron/outbox` (x-cron-secret) — každých ~5 min.
- `POST /api/cron/reminders` (x-cron-secret) — denne ráno.

## Konfigurácia (.env)

```text
MAIL_PROVIDER=RESEND, RESEND_API_KEY
# alebo MAIL_PROVIDER=SMTP:
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
MAIL_FROM=info@zdravyshot.sk, MAIL_REPLY_TO, MAIL_FROM_NAME
FINANCE_MAIL_DKIM_CONFIRMED=true
REMINDER_GRACE_DAYS=3
CRON_SECRET=<openssl rand -hex 32>
```

Bez `DOCUMENT_BUCKET_*` beží lokálne úložisko `.local-bucket/` (dev fallback);
produkcia používa privátny Railway Bucket cez Dev B `S3DocumentStorage`.

## Testy

`npm test` — retry politika/backoff, šablóny (SK obsah), Log provider.
Celý reťazec (finalize → outbox → PDF → EmailDelivery SENT) overený E2E na
lokálnom Postgrese + `.local-bucket` + LogMailProvider.
