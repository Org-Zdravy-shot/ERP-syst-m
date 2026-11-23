import { NextResponse, type NextRequest } from "next/server";
import { configuredSecret, secretMatches } from "@/lib/security/secrets";
import { readS3DocumentStorageConfig, S3DocumentStorage } from "@/lib/finance/documents/storage";
import { refreshTaxRegister } from "@/lib/tax-register/export";
import type { TaxRegisterKind } from "@/lib/tax-register/format";

const urls: Record<TaxRegisterKind, string> = {
  vat: "https://report.financnasprava.sk/ds_dphs.zip",
  income: "https://report.financnasprava.sk/ds_dsrdp.zip",
};

async function* download(kind: TaxRegisterKind): AsyncGenerator<Uint8Array> {
  const response = await fetch(urls[kind], {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(85_000),
  });
  if (!response.ok || !response.body) throw new Error(`Finančná správa vrátila HTTP ${response.status}.`);
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

let refreshing = false;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!configuredSecret(secret)) return NextResponse.json({ status: "disabled" }, { status: 503 });
  if (!secretMatches(secret, request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (refreshing) return NextResponse.json({ status: "in_progress" }, { status: 409 });
  refreshing = true;
  try {
    const storage = new S3DocumentStorage(readS3DocumentStorageConfig());
    const result = [];
    for (const kind of ["vat", "income"] as const) {
      try {
        result.push({ kind, ...await refreshTaxRegister(kind, storage, download(kind)) });
      } catch {
        console.error(`Aktualizácia registra Finančnej správy zlyhala (${kind}).`);
        result.push({ kind, error: "Aktualizácia zlyhala. Zostáva dostupný posledný aktuálny výpis." });
      }
    }
    const failed = result.some(row => "error" in row);
    return NextResponse.json({ status: failed ? "failed" : "done", result }, { status: failed ? 502 : 200 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  } finally {
    refreshing = false;
  }
}
