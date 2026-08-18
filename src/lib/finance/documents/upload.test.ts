import { expect, test } from "vitest";
import { MAX_INVOICE_ATTACHMENT_BYTES } from "./document-service";
import { readInvoiceAttachmentRequest } from "./upload";

test("načíta binárnu prílohu a dekóduje unicode názov", async () => {
  const request = new Request("https://erp.example/api?typ=priloha", {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name-Encoded": encodeURIComponent("Faktúra č. 12.pdf"),
    },
    body: new TextEncoder().encode("%PDF-1.7\ntest"),
  });

  const upload = await readInvoiceAttachmentRequest(request);
  expect(upload.fileName).toBe("Faktúra č. 12.pdf");
  expect(upload.contentType).toBe("application/pdf");
  expect(new TextDecoder().decode(upload.bytes)).toBe("%PDF-1.7\ntest");
});

test("odmietne požiadavku nad limitom ešte podľa Content-Length", async () => {
  const request = new Request("https://erp.example/api?typ=priloha", {
    method: "POST",
    headers: {
      "Content-Length": String(MAX_INVOICE_ATTACHMENT_BYTES + 1),
      "X-File-Name-Encoded": "faktura.pdf",
    },
    body: new Uint8Array([1]),
  });

  await expect(readInvoiceAttachmentRequest(request)).rejects.toMatchObject({
    status: 413,
  });
});

test("vyžaduje názov súboru v hlavičke", async () => {
  const request = new Request("https://erp.example/api?typ=priloha", {
    method: "POST",
    body: new Uint8Array([1]),
  });

  await expect(readInvoiceAttachmentRequest(request)).rejects.toThrow(
    /Chýba názov/,
  );
});
