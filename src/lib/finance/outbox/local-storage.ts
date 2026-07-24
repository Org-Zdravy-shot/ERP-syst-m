import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  DocumentObjectStorage,
  PutImmutableObjectInput,
  StoredObject,
} from "@/lib/finance/documents/types";

/**
 * Lokálne úložisko dokumentov — vývojový/testovací fallback keď nie je
 * nakonfigurovaný privátny Railway Bucket. Implementuje Dev B kontrakt
 * DocumentObjectStorage; produkcia používa S3DocumentStorage bez zmeny.
 * NIKDY sa nepoužije v produkcii (kompozícia si vyberá S3 keď je bucket).
 */
export class LocalFsDocumentStorage implements DocumentObjectStorage {
  readonly provider = "LOCAL_FS";
  readonly bucket: string;

  constructor(private readonly rootDir: string) {
    this.bucket = `local:${rootDir}`;
  }

  private pathFor(objectKey: string): string {
    // objectKey je bezpečný (finance/invoices/<id>/<sha256>.pdf) — bez ../
    return join(this.rootDir, objectKey);
  }

  async putImmutable(input: PutImmutableObjectInput): Promise<void> {
    const path = this.pathFor(input.objectKey);
    await mkdir(dirname(path), { recursive: true });
    // Nemennosť: ak už existuje, neprepisuj (obsahovo adresované → rovnaký obsah).
    try {
      await readFile(path);
      return;
    } catch {
      // neexistuje — zapíš
    }
    await writeFile(path, input.bytes);
  }

  async getObject(objectKey: string): Promise<StoredObject> {
    const buffer = await readFile(this.pathFor(objectKey));
    const bytes = Uint8Array.from(buffer);
    return {
      bytes,
      contentType: "application/pdf",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
  }
}

/** In-memory úložisko pre vitest — bez IO, izolované na inštanciu. */
export class InMemoryDocumentStorage implements DocumentObjectStorage {
  readonly provider = "IN_MEMORY";
  readonly bucket = "memory";
  private readonly objects = new Map<string, Uint8Array>();

  async putImmutable(input: PutImmutableObjectInput): Promise<void> {
    if (!this.objects.has(input.objectKey)) {
      this.objects.set(input.objectKey, input.bytes);
    }
  }

  async getObject(objectKey: string): Promise<StoredObject> {
    const bytes = this.objects.get(objectKey);
    if (!bytes) throw new Error(`Objekt ${objectKey} neexistuje.`);
    return {
      bytes,
      contentType: "application/pdf",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}
