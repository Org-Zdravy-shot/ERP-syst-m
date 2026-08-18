import {
  DocumentAccessError,
  DocumentAuthenticationError,
  DocumentConfigurationError,
  DocumentGenerationError,
  DocumentIntegrityError,
  DocumentNotFoundError,
  DocumentUploadError,
} from "./errors";

export function documentErrorResponse(error: unknown): Response {
  if (error instanceof DocumentAuthenticationError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof DocumentAccessError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof DocumentNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof DocumentIntegrityError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof DocumentUploadError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof DocumentGenerationError) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof DocumentConfigurationError) {
    return Response.json(
      { error: "Privátne úložisko dokumentov nie je nakonfigurované." },
      { status: 503 },
    );
  }

  console.error(
    "Neočakávaná chyba dokumentovej služby:",
    error instanceof Error ? error.message : "neznáma chyba",
  );
  return Response.json(
    { error: "Dokumentovú operáciu sa nepodarilo dokončiť." },
    { status: 500 },
  );
}
