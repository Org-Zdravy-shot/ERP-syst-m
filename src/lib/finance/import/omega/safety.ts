export interface OmegaCommitSafetyInput {
  actualSha256: string;
  confirmedSha256?: string;
  backupReference?: string;
  actorId?: string;
  markIssuedPaid: boolean;
  issuedPaidDateStrategy?: string;
}

export function assertOmegaCommitSafety(input: OmegaCommitSafetyInput): void {
  if (!/^[a-f0-9]{64}$/i.test(input.actualSha256)) {
    throw new Error("Interná chyba: SHA-256 importu nemá platný formát.");
  }
  if (input.confirmedSha256?.toLowerCase() !== input.actualSha256.toLowerCase()) {
    throw new Error("Commit vyžaduje --confirm-sha256 z úspešného dry-runu rovnakého súboru.");
  }
  if (!input.backupReference?.trim() || input.backupReference.trim().length < 8) {
    throw new Error("Commit vyžaduje --backup-reference s identifikátorom overenej databázovej zálohy.");
  }
  if (!input.actorId?.trim()) {
    throw new Error("Commit vyžaduje --actor-id pre auditnú stopu.");
  }
  if (input.markIssuedPaid && input.issuedPaidDateStrategy !== "due-date") {
    throw new Error(
      "Pri historických vydaných faktúrach bez dátumu úhrady je podporovaná iba explicitná stratégia --issued-paid-date=due-date.",
    );
  }
}
