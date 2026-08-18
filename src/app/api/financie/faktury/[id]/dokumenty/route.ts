import { requireFinanceDocumentUser } from "@/lib/finance/documents/authorization";
import { documentErrorResponse } from "@/lib/finance/documents/http";
import { getDocumentService } from "@/lib/finance/documents";
import { readInvoiceAttachmentRequest } from "@/lib/finance/documents/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireFinanceDocumentUser("CREATE_DRAFT");
    const { id } = await context.params;
    const isAttachment = new URL(request.url).searchParams.get("typ") === "priloha";
    const document = isAttachment
      ? await getDocumentService().storeInvoiceAttachment({
          invoiceId: id,
          actorId: user.id,
          actorEmail: user.email,
          ...(await readInvoiceAttachmentRequest(request)),
        })
      : await getDocumentService().generateAndStoreInvoicePdf(id);

    return Response.json(
      {
        id: document.id,
        invoiceId: document.invoiceId,
        type: document.type,
        fileName: document.fileName,
        byteSize: document.byteSize,
        sha256: document.sha256,
        downloadUrl: `/api/financie/dokumenty/${document.id}`,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}
