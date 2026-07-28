import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { DocumentConfigurationError, DocumentNotFoundError } from "./errors";
import type {
  DocumentObjectStorage,
  PutImmutableObjectInput,
  StoredObject,
} from "./types";

const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export interface S3DocumentStorageConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  urlStyle?: "virtual" | "path";
  maxDocumentBytes?: number;
}

function requiredEnvironmentValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  throw new DocumentConfigurationError(
    `Chýba konfigurácia privátneho úložiska: ${names.join(" alebo ")}.`,
  );
}

export function readS3DocumentStorageConfig(): S3DocumentStorageConfig {
  const urlStyle =
    process.env.DOCUMENT_BUCKET_URL_STYLE?.trim().toLowerCase() ||
    process.env.AWS_S3_URL_STYLE?.trim().toLowerCase() ||
    "virtual";
  if (urlStyle !== "virtual" && urlStyle !== "path") {
    throw new DocumentConfigurationError(
      "DOCUMENT_BUCKET_URL_STYLE musí byť „virtual“ alebo „path“.",
    );
  }

  return {
    bucket: requiredEnvironmentValue(["DOCUMENT_BUCKET_NAME", "BUCKET"]),
    endpoint: requiredEnvironmentValue(["DOCUMENT_BUCKET_ENDPOINT", "ENDPOINT"]),
    region:
      process.env.DOCUMENT_BUCKET_REGION?.trim() ||
      process.env.REGION?.trim() ||
      "auto",
    accessKeyId: requiredEnvironmentValue([
      "DOCUMENT_BUCKET_ACCESS_KEY_ID",
      "ACCESS_KEY_ID",
    ]),
    secretAccessKey: requiredEnvironmentValue([
      "DOCUMENT_BUCKET_SECRET_ACCESS_KEY",
      "SECRET_ACCESS_KEY",
    ]),
    urlStyle,
  };
}

function isPreconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.$metadata?.httpStatusCode === 412
  );
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export class S3DocumentStorage implements DocumentObjectStorage {
  readonly provider = "RAILWAY_BUCKET";
  readonly bucket: string;

  private readonly client: S3Client;
  private readonly maxDocumentBytes: number;

  constructor(config: S3DocumentStorageConfig, client?: S3Client) {
    this.bucket = config.bucket;
    this.maxDocumentBytes = config.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;

    const clientConfig: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      // Nové Railway Buckety používajú virtual-hosted S3 URL. Path-style
      // zostáva voliteľný pre staršie alebo iné S3-kompatibilné úložiská.
      forcePathStyle: config.urlStyle === "path",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = client ?? new S3Client(clientConfig);
  }

  async putImmutable(input: PutImmutableObjectInput): Promise<void> {
    if (input.bytes.byteLength > this.maxDocumentBytes) {
      throw new DocumentConfigurationError(
        `Dokument prekračuje limit ${this.maxDocumentBytes} bajtov.`,
      );
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.objectKey,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.contentType,
          IfNoneMatch: "*",
          Metadata: {
            sha256: input.sha256,
            immutable: "true",
          },
        }),
      );
    } catch (error) {
      // Obsahovo adresovaný objekt už môže existovať po úspešnom predchádzajúcom
      // pokuse. Podmienka If-None-Match zabráni akémukoľvek prepísaniu.
      if (!isPreconditionFailure(error)) throw error;
    }
  }

  async getObject(objectKey: string): Promise<StoredObject> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      if (!response.Body) throw new DocumentNotFoundError();
      if (
        typeof response.ContentLength === "number" &&
        response.ContentLength > this.maxDocumentBytes
      ) {
        throw new DocumentConfigurationError(
          `Dokument prekračuje limit ${this.maxDocumentBytes} bajtov.`,
        );
      }

      const bytes = await response.Body.transformToByteArray();
      if (bytes.byteLength > this.maxDocumentBytes) {
        throw new DocumentConfigurationError(
          `Dokument prekračuje limit ${this.maxDocumentBytes} bajtov.`,
        );
      }

      return {
        bytes,
        contentType: response.ContentType ?? "application/octet-stream",
        byteSize: bytes.byteLength,
        sha256: response.Metadata?.sha256,
      };
    } catch (error) {
      if (error instanceof DocumentConfigurationError) throw error;
      if (error instanceof DocumentNotFoundError || isMissingObject(error)) {
        throw new DocumentNotFoundError();
      }
      throw error;
    }
  }
}

export class MemoryDocumentStorage implements DocumentObjectStorage {
  readonly provider = "MEMORY";
  readonly bucket = "memory";

  private readonly objects = new Map<string, StoredObject>();

  async putImmutable(input: PutImmutableObjectInput): Promise<void> {
    if (this.objects.has(input.objectKey)) return;
    this.objects.set(input.objectKey, {
      bytes: Uint8Array.from(input.bytes),
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      sha256: input.sha256,
    });
  }

  async getObject(objectKey: string): Promise<StoredObject> {
    const object = this.objects.get(objectKey);
    if (!object) throw new DocumentNotFoundError();
    return {
      ...object,
      bytes: Uint8Array.from(object.bytes),
    };
  }

  overwriteForTest(objectKey: string, bytes: Uint8Array): void {
    const current = this.objects.get(objectKey);
    if (!current) throw new DocumentNotFoundError();
    this.objects.set(objectKey, {
      ...current,
      bytes: Uint8Array.from(bytes),
      byteSize: bytes.byteLength,
    });
  }
}
