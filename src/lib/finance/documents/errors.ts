export class DocumentNotFoundError extends Error {
  constructor(message = "Dokument sa nenašiel.") {
    super(message);
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentConfigurationError";
  }
}

export class DocumentGenerationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentGenerationError";
  }
}

export class DocumentIntegrityError extends Error {
  constructor(message = "Kontrolný súčet dokumentu nesedí.") {
    super(message);
    this.name = "DocumentIntegrityError";
  }
}

export class DocumentUploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 | 422 = 400,
  ) {
    super(message);
    this.name = "DocumentUploadError";
  }
}

export class DocumentAccessError extends Error {
  constructor(message = "Na túto operáciu nemáte oprávnenie.") {
    super(message);
    this.name = "DocumentAccessError";
  }
}

export class DocumentAuthenticationError extends Error {
  constructor(message = "Pre túto operáciu sa musíte prihlásiť.") {
    super(message);
    this.name = "DocumentAuthenticationError";
  }
}
