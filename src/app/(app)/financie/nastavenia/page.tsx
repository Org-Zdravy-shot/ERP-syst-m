import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDocumentNumber } from "@/lib/finance/domain";
import {
  evaluateProductionIssuingInfrastructure,
} from "@/lib/finance/invoice-service";
import { hasFinancePermission } from "@/lib/finance/permissions";
import { FinanceSettingsForms } from "./FinanceSettingsForms";
import { legalEntityLabels } from "@/lib/zod-schemas";

function dateInputValue(date: Date | null | undefined): string {
  return date?.toISOString().slice(0, 10) ?? "";
}

export default async function FinanceSettingsPage() {
  const user = await requireUser();
  if (!hasFinancePermission(user.role, "CONFIGURE")) notFound();

  const now = new Date();
  const [profile, profiles, products, counter, entityCounters] = await Promise.all([
    prisma.companyProfile.findFirst({
      where: { isActive: true },
      include: {
        taxProfiles: { orderBy: { validFrom: "desc" }, take: 1 },
        bankAccounts: {
          where: { isActive: true, isPrimary: true, currency: "EUR" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { validFrom: "desc" },
    }),
    prisma.companyProfile.findMany({ select: { id: true, legalEntity: true, legalName: true, ico: true, validFrom: true, validTo: true }, orderBy: { validFrom: "desc" }, take: 30 }),
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        vatRates: {
          where: {
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
          orderBy: { validFrom: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.docCounter.findUnique({ where: { id: "VYDANA-2026" } }),
    prisma.docCounter.findMany({ where: { id: { in: ["VYDANA-Z-2026", "VYDANA-K-2026"] } }, select: { id: true, lastNumber: true } }),
  ]);

  const taxProfile = profile?.taxProfiles[0];
  const bankAccount = profile?.bankAccounts[0];
  const startCandidate = profile && profile.validFrom >= now
    ? new Date(profile.validFrom.getTime() + 24 * 60 * 60 * 1000)
    : now;
  const infrastructure = evaluateProductionIssuingInfrastructure();
  const nextSequence = (counter?.lastNumber ?? 0) + 1;
  const numberReady = (counter?.lastNumber ?? 0) >= 8;

  return (
    <>
      <PageHeader
        title="Nastavenia financií"
        subtitle="Časovo platné firemné údaje, DPH, bankový účet a produkčný go-live"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-[14px] border border-stone-200 bg-white p-5">
          <h2 className="font-semibold text-stone-950">Číselné rady vydaných faktúr</h2>
          <p className="mt-2 text-sm">Živnosť: <strong>FAZ2026{String((entityCounters.find((item) => item.id === "VYDANA-Z-2026")?.lastNumber ?? 0) + 1).padStart(3, "0")}</strong></p>
          <p className="mt-1 text-sm">Kurgi s. r. o.: <strong>FAK2026{String((entityCounters.find((item) => item.id === "VYDANA-K-2026")?.lastNumber ?? 0) + 1).padStart(3, "0")}</strong></p>
          <p className="mt-1 text-xs text-stone-500">Nové rady sa použijú až pri výslovne priradenom a potvrdenom subjekte. Staré čísla sa nemenia.</p>
          <p className={`mt-2 text-sm ${numberReady ? "text-[#1F7A0F]" : "text-red-700"}`}>
            Pôvodný spoločný rad: <strong>{formatDocumentNumber("VYDANA", 2026, nextSequence)}</strong>
          </p>
          {!numberReady && (
            <p className="mt-2 text-xs text-red-700">
              Pôvodný spoločný rad vyžaduje samostatné potvrdenie faktúr 2026001–2026008 a počítadla 8.
            </p>
          )}
        </section>
        <section className="rounded-[14px] border border-stone-200 bg-white p-5">
          <h2 className="font-semibold text-stone-950">Produkčná infraštruktúra</h2>
          {infrastructure.ready ? (
            <p className="mt-2 text-sm text-[#1F7A0F]">Bucket, e-mail a produkčný prepínač sú pripravené.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
              {infrastructure.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          )}
        </section>
      </div>
      <section className="mb-6 rounded-[14px] border border-stone-200 bg-white p-5"><h2 className="font-semibold">Existujúce firemné profily</h2><p className="mt-1 text-sm text-stone-500">Staré profily zostávajú bez automatického priradenia. Pri novom profile vyberte subjekt podľa overených údajov.</p><ul className="mt-3 space-y-1 text-sm">{profiles.map((item) => <li key={item.id}>{legalEntityLabels[item.legalEntity ?? ""] ?? "Nepriradený"} · {item.legalName} · IČO {item.ico} · od {dateInputValue(item.validFrom)}{item.validTo ? ` do ${dateInputValue(item.validTo)}` : ""}</li>)}</ul></section>

      <FinanceSettingsForms
        suggestedValidFrom={dateInputValue(startCandidate)}
        profile={{
          legalName: profile?.legalName ?? "",
          tradeName: profile?.tradeName ?? "",
          ico: profile?.ico ?? "",
          dic: profile?.dic ?? "",
          icDph: profile?.icDph ?? "",
          email: profile?.email ?? "info@zdravyshot.sk",
          phone: profile?.phone ?? "",
          street: profile?.street ?? "",
          city: profile?.city ?? "",
          zip: profile?.zip ?? "",
          vatStatus: taxProfile?.vatStatus === "PAYER" ? "PAYER" : "NON_PAYER",
          vatRegisteredFrom: dateInputValue(taxProfile?.vatRegisteredFrom),
          accountantConfirmed: !!taxProfile?.accountantConfirmedAt,
          accountantConfirmedBy: taxProfile?.accountantConfirmedBy ?? "",
          iban: bankAccount?.iban ?? "",
          bic: bankAccount?.bic ?? "",
        }}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          rate: product.vatRates[0]?.rate ?? product.vatRate,
          confirmed: !!product.vatRates[0]?.confirmedAt,
        }))}
      />
    </>
  );
}
