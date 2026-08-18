# Financie v2 — bezpečnostná kontrola 18. augusta 2026

## Výsledok

Kontrola finančných mutácií, dokumentov, externých endpointov, tajomstiev,
auditov a produkčných brán bola vykonaná. Nájdené opraviteľné nedostatky boli
odstránené; produkčné vystavovanie zostáva zámerne vypnuté až do potvrdenia DPH
a e-mailovej domény.

## Opravené nálezy

- Autorizácia už nepoužíva rolu uloženú v session ako zdroj pravdy. Každá
  chránená serverová operácia znova načíta používateľa a jeho aktuálnu rolu z
  databázy. Zmazanie účtu alebo odobratie finančnej roly sa preto prejaví bez
  čakania na nové prihlásenie.
- Cron endpointy, inbox a externé API používajú jednotné porovnanie najmenej
  32-znakových tajomstiev cez `timingSafeEqual`.
- Peňažné vstupy sa parsujú striktne na celé centy. Text za sumou, nekonečno a
  viac než dve desatinné miesta sa odmietnu.
- Ručné faktúry, eKasa, bankové výpisy, dôvody storna a firemný profil majú
  serverové limity počtu, dĺžky a rozsahu vstupov.
- Audit účtovníckeho exportu ukladá iba prijaté a normalizované filtre, nie
  ľubovoľné query parametre.
- Bezpečnostné hlavičky boli doplnené o HSTS, COOP a CORP; existujúce
  `nosniff`, zákaz iframe a referrer policy zostávajú aktívne.
- Závislosti PostCSS, Nanoid a `deepmerge-ts` boli pripnuté na opravené verzie.
  `npm audit --omit=dev` hlási nula známych zraniteľností. Opravy vychádzajú z
  [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp),
  [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) a
  [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
- Prihlasovanie má perzistentný databázový rate limit: kombinácia identity a
  IP sa po 5 zlyhaniach za 15 minút zablokuje na 15 minút, IP po 25
  zlyhaniach. Databáza aj audit obsahujú iba HMAC identifikátory, nikdy surový
  e-mail, heslo ani IP adresu. Neexistujúci používateľ prejde rovnakou bcrypt
  kontrolou, aby odpoveď neprezrádzala existenciu účtu.

## Overené kontroly

- financie sú dostupné len rolám `admin`, `FINANCE_ADMIN` a
  `FINANCE_OPERATOR` podľa explicitných oprávnení;
- finalizácia, storno, dobropis, platobná alokácia, import, príloha, download,
  e-mail a export majú autorizáciu a auditnú stopu;
- dokumenty sú v privátnom buckete, zapisujú sa nemenne a pred downloadom sa
  kontroluje SHA-256;
- cron tajomstvo, API kľúče, bucket credentials, bankové tokeny a mailové
  tajomstvá nie sú súčasťou repozitára;
- `FINANCE_PRODUCTION_ISSUING_ENABLED=false` zostáva fail-closed bránou.

## Read-only produkčný readiness check

Kontrola nevytvorila ani nezmenila žiadny produkčný doklad. Potvrdila:

| Kontrola | Stav |
|---|---:|
| Vydané faktúry | 8 |
| Plne uhradené vydané faktúry | 8 |
| Prijaté faktúry | 2 |
| Nasledujúce vydané číslo | `2026009` |
| Privátny bucket nakonfigurovaný | áno |
| Aktívny profil pre nový doklad | nie |
| DKIM potvrdený | nie |
| Produkčné vystavovanie | vypnuté |

Plný E2E scenár sa preto správne zastaví pred finalizáciou. Dokončí sa až po
písomnom potvrdení dátumu a sadzieb DPH a po aktivácii Resend/DKIM; dovtedy sa
nesmie obísť go-live gate.

## Otvorené riziká a externé závislosti

- Produkčná aktivácia Resend a DKIM je odložená v
  [issue #29](https://github.com/Org-Zdravy-shot/ERP-syst-m/issues/29).
- Tatra Premium API zostáva vypnuté do ukončenia bankového onboardingu a
  sandbox kontraktných testov.
- CSP sa nezapína naslepo, pretože Next.js používa frameworkové inline skripty;
  vhodná nonce-based politika sa má otestovať samostatne, aby nerozbila ERP UI.
