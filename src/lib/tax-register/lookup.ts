import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { DocumentNotFoundError } from "@/lib/finance/documents/errors";
import type { DocumentObjectStorage } from "@/lib/finance/documents/types";
import { readS3DocumentStorageConfig, S3DocumentStorage } from "@/lib/finance/documents/storage";
import { findRegisterRow, maxSnapshotBytes, registerObjectKey, rowWidth, slovakRegisterDate, type CustomerVatStatus, type TaxRegisterKind } from "./format";

const decompress = promisify(gunzip);
const DAY = 86_400_000;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

type Snapshot = { body: Buffer; date: string };
type Snapshots = { income?: Snapshot; vat?: Snapshot };
let cached: { expires: number; loading: Promise<Snapshots> } | undefined;

async function loadSnapshot(storage: DocumentObjectStorage, kind: TaxRegisterKind, now: Date): Promise<Snapshot | undefined> {
  for (let days = 0; days <= 4; days++) {
    const date = slovakRegisterDate(new Date(now.getTime() - days * DAY));
    try {
      const data = await storage.getObject(registerObjectKey(kind, date));
      const body = await decompress(data.bytes, { maxOutputLength: maxSnapshotBytes });
      if (!body.length || body.length % rowWidth[kind]) throw new Error("Poškodený index Finančnej správy.");
      return { date, body };
    } catch (error) {
      if (!(error instanceof DocumentNotFoundError)) throw error;
    }
  }
  return undefined;
}

async function snapshots(now: Date): Promise<Snapshots> {
  let storage: S3DocumentStorage;
  try {
    storage = new S3DocumentStorage(readS3DocumentStorageConfig());
  } catch {
    return {};
  }
  const [income, vat] = await Promise.allSettled([
    loadSnapshot(storage, "income", now),
    loadSnapshot(storage, "vat", now),
  ]);
  return {
    income: income.status === "fulfilled" ? income.value : undefined,
    vat: vat.status === "fulfilled" ? vat.value : undefined,
  };
}

export interface CustomerTaxDetails {
  dic: string;
  icDph: string;
  vatStatus: CustomerVatStatus;
  vatCheckedOn?: string;
}

export function lookupCustomerTax(ico: string, data: Snapshots): CustomerTaxDetails {
  const dic = data.income ? findRegisterRow(data.income.body, rowWidth.income, ico) || "" : "";
  const row = data.vat ? findRegisterRow(data.vat.body, rowWidth.vat, ico) : undefined;
  const id = row?.slice(0, 12) ?? "";
  const icDph = /^SK\d{10}$/.test(id) ? id : "";
  const status = row?.charAt(12);
  const vatStatus: CustomerVatStatus = status === "P" ? "PAYER"
    : status === "R" ? "REGISTERED_NON_PAYER"
    : row === undefined && data.vat ? "NON_PAYER" : "UNKNOWN";
  return { dic, icDph, vatStatus, vatCheckedOn: data.vat?.date };
}

export async function loadCustomerTaxRegister(): Promise<Snapshots> {
  const now = new Date();
  if (!cached || cached.expires <= now.getTime()) {
    cached = { expires: now.getTime() + CHECK_INTERVAL_MS, loading: snapshots(now) };
  }
  return cached.loading;
}
