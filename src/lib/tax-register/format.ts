export type TaxRegisterKind = "vat" | "income";
export type CustomerVatStatus = "PAYER" | "REGISTERED_NON_PAYER" | "NON_PAYER" | "UNKNOWN";

export const rowWidth = { income: 18, vat: 21 };
export const maxSnapshotBytes = 32 * 1024 * 1024;

export function slovakRegisterDate(at = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format(at);
}

export function registerObjectKey(kind: TaxRegisterKind, date: string): string {
  return `registry/fs/v1/${kind}/${date}.gz`;
}

export function findRegisterRow(bytes: Buffer, width: number, ico: string): string | undefined {
  let low = 0;
  let high = bytes.length / width;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const offset = middle * width;
    const key = bytes.toString("ascii", offset, offset + 8);
    if (key === ico) return bytes.toString("ascii", offset + 8, offset + width).trimEnd();
    if (key < ico) low = middle + 1;
    else high = middle;
  }
  return undefined;
}
