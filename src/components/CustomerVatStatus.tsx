import type { CustomerVatStatus as VatStatus } from "@/lib/tax-register/format";

const labels: Record<VatStatus, string> = {
  PAYER: "Platiteľ DPH",
  REGISTERED_NON_PAYER: "Registrovaný pre DPH, neplatiteľ",
  NON_PAYER: "Bez registrácie DPH podľa zoznamu FS",
  UNKNOWN: "Stav DPH neoverený",
};

export function CustomerVatStatus({ status, checkedOn }: { status?: VatStatus; checkedOn?: string }) {
  if (!status) return null;
  const date = checkedOn?.split("-").reverse().join(".");
  return (
    <span className="block text-xs font-medium text-stone-600">
      {labels[status]}{date && ` · FS ${date}`}
    </span>
  );
}
