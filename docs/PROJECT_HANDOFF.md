# ERP Zdravý Shot — odovzdávací bod a pokračovanie

Aktualizované: **12. septembra 2026**

Tento dokument je prvý zdroj po reštarte počítača alebo novej vývojovej
relácii. Rovnaký stav je dostupný v produkčnom ERP na stránke
`/manual` (**Manuál** v ľavom menu).

## Kde sme skončili

- Git vetva: `main`, synchronizovaná s `origin/main`.
- Posledný aplikačný commit pred týmto manuálom: `b978f20` — eFaktúra panel.
- Posledné overené Railway nasadenie:
  `126d9b63-6568-4a96-85e5-530474586dd7`, stav `SUCCESS`.
- Produkčný health check bol úspešný.
- Posledná kompletná lokálna kontrola: **48 testovacích súborov, 210 testov**,
  typecheck a produkčný build úspešné.
- Dodávateľský modul S0–S2 je hotový; S3 sú budúce automatizácie.
- eFaktúra implementácia je v PR #40–#49: klient, UBL, perzistencia,
  recipient lookup, HMAC webhook, nemenný archív a validačný panel.

## Aktuálny produkčný stav na Railwayi

Overené 12. septembra 2026 bez vypísania tajných hodnôt:

| Nastavenie | Stav |
|---|---|
| `FINANCE_PRODUCTION_ISSUING_ENABLED` | `false` |
| `EINVOICE_ENABLED` | chýba / vypnuté |
| `EINVOICE_LIVE_ENABLED` | chýba / vypnuté |
| `TATRA_PREMIUM_ENABLED` | `false` |
| `FINANCE_MAIL_DKIM_CONFIRMED` | `false` |
| `EFAKTURA_API_BASE` | chýba |
| `EFAKTURA_API_KEY` | chýba |
| `EFAKTURA_ORGANIZATION_ID` | chýba |
| `EFAKTURA_WEBHOOK_SECRET` | chýba |

Tieto vypnuté brány sú zámerné. Produkčné faktúry, živá eFaktúra, Tatra API
ani produkčný e-mail sa nesmú zapnúť iba preto, že sa začala nová relácia.

## Prvý krok po návrate — zatiaľ NESPRAVENÉ

Vlastník účtu ešte **nespravil onboarding eFaktura.sk sandboxu**. Aktuálna
úloha je [GitHub issue #44](https://github.com/Org-Zdravy-shot/ERP-syst-m/issues/44).

Postup vlastníka:

1. Prihlásiť sa na <https://developers.efaktura.sk/>.
2. Vytvoriť organizáciu Zdravý Shot pre vlastný ERP s presnými firemnými
   údajmi a adresou.
3. Vytvoriť iba sandbox kľúč `efk_pk_test_…` so scopes `invoice:send` a
   `invoice:read`.
4. Skopírovať Organization ID a aktivovať Peppol sandbox enroll.
5. Zaregistrovať webhook:
   `https://erp-syst-m-production.up.railway.app/api/financie/einvoice/webhook`
   pre udalosti `peppol.document.sent`, `peppol.document.delivered`,
   `peppol.document.failed` a `peppol.document.received`.
6. Vložiť API kľúč, Organization ID a jednorazovo zobrazený webhook secret
   priamo do Railway Variables podľa issue #44. Tajomstvá nedávať do chatu,
   GitHub issue ani repozitára.
7. `EINVOICE_ENABLED` aj `EINVOICE_LIVE_ENABLED` zatiaľ ponechať `0` a
   vývojárovi napísať iba **„sandbox hotovo“**.

Následný krok vývoja:

1. Bezpečne overiť iba prítomnosť premenných a testovací prefix kľúča.
2. Zapnúť výlučne `EINVOICE_ENABLED=1`; live a produkčné vystavovanie ponechať
   vypnuté.
3. Na testovacej faktúre spustiť recipient lookup, nemenné UBL a
   `validateOnly`.
4. Overiť podpísaný webhook, deduplikáciu a replay.
5. Až potom implementovať/aktivovať sandbox odosielací outbox a dokončiť
   end-to-end test. Živé odoslanie sa v tomto kroku nerobí.

## Čo ostáva po sandboxe

- eFaktúra: sandbox odosielací outbox, príjem dokladov, finálny E2E a až potom
  samostatne schválený produkčný onboarding;
- DPH: písomné potvrdenie účtovníka pre dátum registrácie, KN zatriedenie a
  sadzbu každého produktu; október 2026 a plošných 23 % sú stále iba
  nepotvrdené odhady;
- e-mail: odložená aktivácia Resend, DNS a skúšobné overenie DKIM/SPF/DMARC —
  [issue #29](https://github.com/Org-Zdravy-shot/ERP-syst-m/issues/29);
- Tatra Premium API: onboarding, consent/tokeny a sandbox; dovtedy zostáva
  `TATRA_PREMIUM_ENABLED=false` a používa sa kontrolovaný import výpisu;
- po splnení externých brán dokončiť spoločný E2E scenár a produkčný cutover.

## Bezpečný štart novej relácie

```bash
cd /Users/macbook/Documents/ERP-system
git status --short --branch
git pull --ff-only origin main
```

Potom si prečítať v tomto poradí:

1. `AGENTS.md`
2. tento `docs/PROJECT_HANDOFF.md`
3. `docs/EINVOICE_PROVIDER_DECISION.md`
4. `docs/FINANCE_V2_IMPLEMENTATION_PLAN.md`
5. `docs/SUPPLIER_MODULE_PLAN.md`

Pred ďalším nasadením znova spustiť testy, typecheck a build. Existujúce
databázové dumpy v `backups/` sú lokálne a nesmú sa commitnúť do GitHubu.
