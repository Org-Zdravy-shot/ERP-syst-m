import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import type { DocumentObjectStorage } from "@/lib/finance/documents/types";
import { maxSnapshotBytes, registerObjectKey, rowWidth, slovakRegisterDate, type TaxRegisterKind } from "./format";

const sources = {
  vat: { filename: "ds_dphs.xml", root: "ZoznamSubjektovRegistrovanychkDPH", list: "DS_DPHS", minRows: 50_000 },
  income: { filename: "ds_dsrdp.xml", root: "ZoznamSubjektovRegistrovanychNaDP", list: "DS_DSRDP", minRows: 300_000 },
};
const maxZipBytes = 100 * 1024 * 1024;
const maxXmlBytes = 600 * 1024 * 1024;
const compress = promisify(gzip);

function dateFromSlovakExport(value: string): string {
  const match = /^(\d{2})\.?(\d{2})\.?(\d{4})$/.exec(value.trim());
  if (!match) throw new Error("Neplatný dátum vo výpise Finančnej správy.");
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Neplatný dátum vo výpise Finančnej správy.");
  }
  return date;
}

function vatCode(kind: string, from: string, snapshotDate: string): string {
  if (/^§\s*7a?$/i.test(kind)) return "R";
  if (/^§\s*(4b?|5)$/i.test(kind) && from) {
    return dateFromSlovakExport(from) <= snapshotDate ? "P" : "R";
  }
  return "?";
}

export async function parseTaxRegisterZip(
  kind: TaxRegisterKind,
  chunks: AsyncIterable<Uint8Array>,
): Promise<{ date: string; count: number; body: Buffer }> {
  const source = sources[kind];
  const values = new Map<string, string>();
  const path: string[] = [];
  const relevant = new Set(kind === "vat" ? ["ICO", "IC_DPH", "DRUH_REG_DPH", "PLAT_DPH_OD"] : ["ICO", "DIC"]);
  let field = "";
  let text = "";
  let snapshotDate = "";
  let item: Record<string, string> = {};
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new Error("Vo výpise registra nie je povolené DTD."); });
  parser.on("opentag", ({ name }) => {
    path.push(name);
    if (path.length > 4 || (path.length === 1 && name !== source.root)) throw new Error("Neočekávaná štruktúra daňového registra.");
    if (path.length === 3 && path[1] === source.list && name === "ITEM") item = {};
    if ((path.length === 2 && name === "DatumAktualizacieZoznamu") ||
        (path.length === 4 && path[1] === source.list && path[2] === "ITEM" && relevant.has(name))) {
      field = name;
      text = "";
    }
  });
  parser.on("text", (value) => {
    if (!field) return;
    text += value;
    if (text.length > 100) throw new Error("Pole vo výpise daňového registra je príliš dlhé.");
  });
  parser.on("closetag", ({ name }) => {
    if (field === name) {
      if (name === "DatumAktualizacieZoznamu") snapshotDate = dateFromSlovakExport(text);
      else item[name] = text.trim();
      field = "";
    }
    if (path.length === 3 && path[1] === source.list && name === "ITEM" && /^\d{8}$/.test(item.ICO ?? "")) {
      if (!snapshotDate) throw new Error("Chýba dátum výpisu Finančnej správy.");
      const value = kind === "income"
        ? (/^\d{10}$/.test(item.DIC ?? "") ? item.DIC : "")
        : (/^SK\d{10}$/.test(item.IC_DPH ?? "") ? item.IC_DPH : " ".repeat(12)) +
          vatCode(item.DRUH_REG_DPH ?? "", item.PLAT_DPH_OD ?? "", snapshotDate);
      const previous = values.get(item.ICO);
      values.set(item.ICO, previous === undefined || previous === value ? value : (kind === "vat" ? " ".repeat(12) + "?" : ""));
      if (values.size * rowWidth[kind] > maxSnapshotBytes) throw new Error("Daňový register prekročil limit indexu.");
    }
    path.pop();
  });

  let found = false;
  let complete = false;
  let unpacked = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const zip = new Unzip((file) => {
    if (file.name !== source.filename) return;
    if (found) throw new Error("Archív registra obsahuje duplicitný výpis.");
    found = true;
    if (file.originalSize && file.originalSize > maxXmlBytes) throw new Error("XML výpis registra je príliš veľký.");
    file.ondata = (error, bytes, final) => {
      if (error) throw error;
      unpacked += bytes.length;
      if (unpacked > maxXmlBytes) throw new Error("XML výpis registra je príliš veľký.");
      parser.write(decoder.decode(bytes, { stream: !final }));
      if (final) { parser.close(); complete = true; }
    };
    file.start();
  });
  zip.register(UnzipInflate);
  let received = 0;
  for await (const chunk of chunks) {
    received += chunk.length;
    if (received > maxZipBytes) throw new Error("Archív registra je príliš veľký.");
    for (let offset = 0; offset < chunk.length; offset += 16_384) {
      zip.push(chunk.subarray(offset, offset + 16_384));
    }
  }
  zip.push(new Uint8Array(), true);
  if (!complete || !snapshotDate) throw new Error("Archív registra neobsahuje úplný výpis.");

  const body = Buffer.alloc(values.size * rowWidth[kind]);
  let offset = 0;
  for (const ico of [...values.keys()].sort()) {
    body.write(ico + values.get(ico)!.padEnd(rowWidth[kind] - 8), offset, rowWidth[kind], "ascii");
    offset += rowWidth[kind];
  }
  return { date: snapshotDate, count: values.size, body };
}

export async function refreshTaxRegister(
  kind: TaxRegisterKind,
  storage: DocumentObjectStorage,
  chunks: AsyncIterable<Uint8Array>,
  now = new Date(),
): Promise<{ date: string; count: number }> {
  const result = await parseTaxRegisterZip(kind, chunks);
  const earliest = slovakRegisterDate(new Date(now.getTime() - 4 * 86_400_000));
  if (result.count < sources[kind].minRows || result.date < earliest || result.date > slovakRegisterDate(now)) {
    throw new Error("Výpis Finančnej správy je neúplný alebo nemá aktuálny dátum.");
  }
  const bytes = await compress(result.body, { level: 4 });
  await storage.putImmutable({
    objectKey: registerObjectKey(kind, result.date),
    bytes,
    contentType: "application/gzip",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  return { date: result.date, count: result.count };
}
