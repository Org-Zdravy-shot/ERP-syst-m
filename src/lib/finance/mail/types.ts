import type { MailProvider } from "@/lib/finance/contracts";

/** Príloha už s načítanými bajtmi (provider ich pripojí k správe). */
export interface ResolvedAttachment {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Provider dostáva v MailMessage len documentIds; bajty príloh mu dodá
 * loader (kompozícia ich číta zo storage a overuje hash). Rozširujeme
 * kontraktný MailProvider o schopnosť pracovať s vyriešenými prílohami.
 */
export interface AttachmentLoader {
  load(documentId: string): Promise<ResolvedAttachment>;
}

export type { MailProvider };
