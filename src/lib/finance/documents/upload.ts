import { MAX_INVOICE_ATTACHMENT_BYTES } from "./document-service";
import { DocumentUploadError } from "./errors";

const FILE_NAME_HEADER = "x-file-name-encoded";

function decodeFileName(value: string | null): string {
  if (!value) {
    throw new DocumentUploadError("Chýba názov nahrávanej prílohy.");
  }
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded) throw new Error("empty");
    return decoded;
  } catch {
    throw new DocumentUploadError("Názov nahrávanej prílohy je neplatný.");
  }
}

export async function readInvoiceAttachmentRequest(request: Request): Promise<{
  fileName: string;
  contentType?: string;
  bytes: Uint8Array;
}> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_INVOICE_ATTACHMENT_BYTES) {
      throw new DocumentUploadError("Príloha môže mať najviac 10 MB.", 413);
    }
  }

  const fileName = decodeFileName(request.headers.get(FILE_NAME_HEADER));
  if (!request.body) throw new DocumentUploadError("Príloha je prázdna.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteSize += value.byteLength;
    if (byteSize > MAX_INVOICE_ATTACHMENT_BYTES) {
      await reader.cancel();
      throw new DocumentUploadError("Príloha môže mať najviac 10 MB.", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    fileName,
    contentType: request.headers.get("content-type")?.trim() || undefined,
    bytes,
  };
}
