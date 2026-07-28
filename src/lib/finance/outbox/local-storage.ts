import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { DocumentIntegrityError } from "@/lib/finance/documents/errors";
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
  private readonly absoluteRoot: string;

  constructor(private readonly rootDir: string) {
    this.absoluteRoot = resolve(rootDir);
    this.bucket = `local:${this.absoluteRoot}`;
  }

  private pathFor(objectKey: string): string {
    const path = resolve(this.absoluteRoot, objectKey);
    if (!path.startsWith(`${this.absoluteRoot}${sep}`)) {
      throw new DocumentIntegrityError(
        "Neplatný objectKey lokálneho dokumentu.",
      );
    }
    return path;
  }

  private async assertExistingContent(
    path: string,
    expectedSha256: string,
  ): Promise<boolean> {
    try {
      const existing = await readFile(path);
      const existingHash = createHash("sha256").update(existing).digest("hex");
      if (existingHash !== expectedSha256) {
        throw new DocumentIntegrityError(
          "Existujúci lokálny dokument má iný obsah.",
        );
      }
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  async putImmutable(input: PutImmutableObjectInput): Promise<void> {
    const path = this.pathFor(input.objectKey);
    await mkdir(dirname(path), { recursive: true });
    if (await this.assertExistingContent(path, input.sha256)) return;

    try {
      await writeFile(path, input.bytes, { flag: "wx" });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        await this.assertExistingContent(path, input.sha256);
        return;
      }
      throw error;
    }
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
    const existing = this.objects.get(input.objectKey);
    if (existing) {
      const existingHash = createHash("sha256").update(existing).digest("hex");
      if (existingHash !== input.sha256) {
        throw new DocumentIntegrityError(
          "Existujúci testovací dokument má iný obsah.",
        );
      }
      return;
    }
    this.objects.set(input.objectKey, Uint8Array.from(input.bytes));
  }

  async getObject(objectKey: string): Promise<StoredObject> {
    const bytes = this.objects.get(objectKey);
    if (!bytes) throw new Error(`Objekt ${objectKey} neexistuje.`);
    return {
      bytes: Uint8Array.from(bytes),
      contentType: "application/pdf",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}
