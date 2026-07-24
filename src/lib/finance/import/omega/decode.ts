import { unzipSync } from "fflate";
import type { DecodedOmegaExport } from "./types";

const ZIP_LOCAL_FILE_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

function isZip(bytes: Uint8Array): boolean {
  return ZIP_LOCAL_FILE_SIGNATURE.every((value, index) => bytes[index] === value);
}

function decodeWindows1250(bytes: Uint8Array): string {
  return new TextDecoder("windows-1250", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
}

export function decodeOmegaExport(bytes: Uint8Array): DecodedOmegaExport {
  if (!isZip(bytes)) {
    return { entryName: "omega.txt", text: decodeWindows1250(bytes) };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new Error(`Omega ZIP sa nepodarilo rozbaliť: ${error instanceof Error ? error.message : "neznáma chyba"}`);
  }

  const names = Object.keys(entries).filter((name) => !name.endsWith("/"));
  const preferred = names.find((name) => /(^|\/)omega\.txt$/i.test(name));
  const fallback = names.length === 1 && /\.txt$/i.test(names[0] ?? "") ? names[0] : undefined;
  const entryName = preferred ?? fallback;
  if (!entryName) {
    throw new Error("ZIP neobsahuje jednoznačný súbor Omega/omega.txt.");
  }

  return { entryName, text: decodeWindows1250(entries[entryName]) };
}
