import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OmegaInvoice, OmegaPartner, ParsedOmegaExport } from "./types";

type Tx = Prisma.TransactionClient;

export interface CommitOmegaImportInput {
  parsed: ParsedOmegaExport;
  fileName: string;
  sha256: string;
  backupReference: string;
  actorId: string;
  actorEmail?: string;
  markIssuedPaid: boolean;
  issuedPaidDateStrategy?: "due-date";
}

export interface CommitOmegaImportResult {
  batchId: string;
  alreadyCommitted: boolean;
  invoiceCount: number;
  paymentCount: number;
  nextIssuedNumber: string | null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function partySnapshot(partner: OmegaPartner): Record<string, string> {
  return {
    name: partner.name,
    ...(partner.ico ? { ico: partner.ico } : {}),
    ...(partner.dic ? { dic: partner.dic } : {}),
    ...(partner.icDph ? { icDph: partner.icDph } : {}),
    ...(partner.phone ? { phone: partner.phone } : {}),
    ...(partner.street ? { street: partner.street } : {}),
    ...(partner.city ? { city: partner.city } : {}),
    ...(partner.zip ? { zip: partner.zip } : {}),
    country: partner.country,
  };
}

async function matchOrCreatePartner(tx: Tx, partner: OmegaPartner): Promise<string> {
  const existing =
    (partner.ico ? await tx.client.findFirst({ where: { ico: partner.ico } }) : null) ??
    (await tx.client.findFirst({ where: { name: partner.name } }));
  if (!existing) {
    const created = await tx.client.create({
      data: {
        type: partner.ico ? "B2B" : "B2C",
        name: partner.name,
        ico: partner.ico ?? null,
        dic: partner.dic ?? null,
        icDph: partner.icDph ?? null,
        phone: partner.phone ?? null,
        street: partner.street ?? null,
        city: partner.city ?? null,
        zip: partner.zip ?? null,
        country: partner.country,
      },
    });
    return created.id;
  }

  const fillMissing = {
    ...(!existing.ico && partner.ico ? { ico: partner.ico } : {}),
    ...(!existing.dic && partner.dic ? { dic: partner.dic } : {}),
    ...(!existing.icDph && partner.icDph ? { icDph: partner.icDph } : {}),
    ...(!existing.phone && partner.phone ? { phone: partner.phone } : {}),
    ...(!existing.street && partner.street ? { street: partner.street } : {}),
    ...(!existing.city && partner.city ? { city: partner.city } : {}),
    ...(!existing.zip && partner.zip ? { zip: partner.zip } : {}),
  };
  if (Object.keys(fillMissing).length > 0) {
    await tx.client.update({ where: { id: existing.id }, data: fillMissing });
  }
  return existing.id;
}

async function companyContext(tx: Tx, invoice: OmegaInvoice) {
  const taxDate = invoice.deliveryDate;
  const company = await tx.companyProfile.findFirst({
    where: {
      isActive: true,
      validFrom: { lte: taxDate },
      OR: [{ validTo: null }, { validTo: { gte: taxDate } }],
    },
    include: {
      taxProfiles: {
        where: {
          validFrom: { lte: taxDate },
          OR: [{ validTo: null }, { validTo: { gte: taxDate } }],
        },
        orderBy: { validFrom: "desc" },
        take: 1,
      },
      bankAccounts: {
        where: { isActive: true, isPrimary: true, currency: "EUR" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { validFrom: "desc" },
  });
  if (!company) {
    throw new Error(
      `Faktúra ${invoice.invoiceNumber}: pre dátum ${taxDate.toISOString().slice(0, 10)} chýba platný firemný profil.`,
    );
  }
  const taxProfile = company.taxProfiles[0];
  if (!taxProfile) {
    throw new Error(
      `Faktúra ${invoice.invoiceNumber}: pre dátum ${taxDate.toISOString().slice(0, 10)} chýba platný daňový profil.`,
    );
  }
  if (
    invoice.direction === "VYDANA" &&
    taxProfile.vatStatus === "PAYER" &&
    invoice.totalVatCents === 0 &&
    taxProfile.domesticTaxMode !== "EXEMPT"
  ) {
    throw new Error(
      `Faktúra ${invoice.invoiceNumber}: export je bez DPH, ale platný profil označuje firmu ako platiteľa DPH.`,
    );
  }
  const bank = company.bankAccounts[0];
  const snapshot = {
    name: company.legalName,
    ico: company.ico,
    dic: company.dic,
    ...(company.icDph ? { icDph: company.icDph } : {}),
    email: company.email,
    ...(company.phone ? { phone: company.phone } : {}),
    street: company.street,
    city: company.city,
    zip: company.zip,
    country: company.country,
    ...(bank ? { iban: bank.iban } : {}),
    ...(bank?.bic ? { bic: bank.bic } : {}),
  };
  const taxSnapshot = {
    vatStatus: taxProfile.vatStatus === "PAYER" ? "PAYER" : "NON_PAYER",
    ...(taxProfile.vatRegisteredFrom
      ? { vatRegisteredFrom: taxProfile.vatRegisteredFrom.toISOString() }
      : {}),
    domesticTaxMode: taxProfile.domesticTaxMode === "EXEMPT" ? "EXEMPT" : "STANDARD",
    deliveryDate: invoice.deliveryDate.toISOString(),
  };
  return { snapshot, taxSnapshot };
}

async function createPayment(
  tx: Tx,
  invoice: OmegaInvoice,
  invoiceId: string,
  actorId: string,
  paidAt: Date,
  paidDateWasAssumed: boolean,
): Promise<void> {
  await tx.payment.create({
    data: {
      direction: invoice.direction === "VYDANA" ? "INCOMING" : "OUTGOING",
      source: "MANUAL",
      amountCents: invoice.totalGrossCents,
      currency: invoice.currency,
      paidAt,
      reference: `OMEGA:${invoice.externalId}`,
      variableSymbol: invoice.variableSymbol ?? null,
      counterpartyName: invoice.partner.name,
      note: paidDateWasAssumed
        ? "Migrácia Omega: faktúra bola potvrdená ako uhradená; export neobsahoval dátum úhrady, preto bol použitý dátum splatnosti."
        : "Migrácia Omega: dátum úhrady prevzatý z exportu.",
      createdById: actorId,
      allocations: {
        create: {
          invoiceId,
          amountCents: invoice.totalGrossCents,
          createdById: actorId,
        },
      },
    },
  });
}

export async function commitOmegaImport(input: CommitOmegaImportInput): Promise<CommitOmegaImportResult> {
  if (input.parsed.errors.length > 0) {
    throw new Error(`Omega import obsahuje ${input.parsed.errors.length} blokujúcich chýb.`);
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("Omega import vyžaduje platný SHA-256 súboru.");
  if (!input.backupReference.trim()) throw new Error("Omega import vyžaduje referenciu databázovej zálohy.");
  if (!input.actorId.trim()) throw new Error("Omega import vyžaduje používateľa pre audit.");
  if (input.markIssuedPaid && input.issuedPaidDateStrategy !== "due-date") {
    throw new Error("Označenie vydaných faktúr za uhradené vyžaduje explicitnú stratégiu dátumu úhrady.");
  }

  return prisma.$transaction(async (tx) => {
    const prior = await tx.importBatch.findUnique({
      where: { source_sha256_mode: { source: "OMEGA", sha256: input.sha256, mode: "COMMIT" } },
    });
    if (prior?.status === "COMMITTED") {
      return {
        batchId: prior.id,
        alreadyCommitted: true,
        invoiceCount: prior.invoiceCount,
        paymentCount: Number(
          prior.summary && typeof prior.summary === "object" && !Array.isArray(prior.summary)
            ? (prior.summary as Record<string, unknown>).paymentCount ?? 0
            : 0,
        ),
        nextIssuedNumber: input.parsed.summary.nextIssuedNumber,
      };
    }
    if (prior) {
      throw new Error(`Importný batch ${prior.id} už existuje v stave ${prior.status}; vyžaduje manuálnu kontrolu.`);
    }

    const invoiceNumbers = input.parsed.invoices.map((invoice) => invoice.invoiceNumber);
    const externalIds = input.parsed.invoices.map((invoice) => invoice.externalId);
    const collision = await tx.invoice.findFirst({
      where: {
        OR: [
          { invoiceNumber: { in: invoiceNumbers } },
          { source: "OMEGA", externalId: { in: externalIds } },
        ],
      },
      select: { invoiceNumber: true, source: true, externalId: true },
    });
    if (collision) {
      throw new Error(
        `Import by prepísal existujúcu faktúru ${collision.invoiceNumber ?? collision.externalId ?? "(bez čísla)"} zo zdroja ${collision.source}.`,
      );
    }

    const batch = await tx.importBatch.create({
      data: {
        source: "OMEGA",
        fileName: input.fileName,
        sha256: input.sha256,
        mode: "COMMIT",
        status: "PENDING",
        partnerCount: input.parsed.summary.partnerCount,
        invoiceCount: input.parsed.summary.invoiceCount,
        itemCount: input.parsed.summary.itemCount,
        totalGrossCents: input.parsed.summary.totalGrossCents,
        warningCount: input.parsed.summary.warningCount,
        errorCount: 0,
        backupReference: input.backupReference,
        createdById: input.actorId,
      },
    });

    let paymentCount = 0;
    for (const invoice of input.parsed.invoices) {
      const clientId = await matchOrCreatePartner(tx, invoice.partner);
      const company = await companyContext(tx, invoice);
      const externalParty = partySnapshot(invoice.partner);
      const created = await tx.invoice.create({
        data: {
          direction: invoice.direction,
          documentType: "INVOICE",
          documentStatus: "ISSUED",
          source: "OMEGA",
          externalId: invoice.externalId,
          externalNumber: invoice.externalNumber,
          invoiceNumber: invoice.invoiceNumber,
          currency: invoice.currency,
          clientId,
          supplierName: invoice.direction === "PRIJATA" ? invoice.partner.name : null,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          deliveryDate: invoice.deliveryDate,
          finalizedAt: invoice.issueDate,
          createdById: input.actorId,
          finalizedById: input.actorId,
          status:
            (invoice.direction === "VYDANA" && input.markIssuedPaid) || invoice.paidAt
              ? "UHRADENA"
              : "VYSTAVENA",
          totalNetCents: invoice.totalNetCents,
          totalVatCents: invoice.totalVatCents,
          totalGrossCents: invoice.totalGrossCents,
          variableSymbol: invoice.variableSymbol ?? null,
          issuerSnapshot: toJson(invoice.direction === "VYDANA" ? company.snapshot : externalParty),
          counterpartySnapshot: toJson(invoice.direction === "VYDANA" ? externalParty : company.snapshot),
          taxSnapshot: toJson(company.taxSnapshot),
          note: invoice.note ?? null,
          items: {
            create: invoice.items.map((item, index) => ({
              lineNumber: index + 1,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPriceCents: item.unitPriceCents,
              vatRate: item.vatRate,
              totalNetCents: item.totalNetCents,
              totalVatCents: item.totalVatCents,
              totalGrossCents: item.totalGrossCents,
              taxCategory: "EXEMPT",
            })),
          },
        },
      });

      const paidAt =
        invoice.paidAt ??
        (invoice.direction === "VYDANA" && input.markIssuedPaid ? invoice.dueDate : undefined);
      if (paidAt) {
        await createPayment(tx, invoice, created.id, input.actorId, paidAt, !invoice.paidAt);
        paymentCount += 1;
      }

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          actorEmail: input.actorEmail ?? null,
          action: "OMEGA_INVOICE_IMPORTED",
          entityType: "Invoice",
          entityId: created.id,
          afterData: toJson({
            invoiceNumber: created.invoiceNumber,
            direction: created.direction,
            totalGrossCents: created.totalGrossCents,
            status: created.status,
          }),
          metadata: toJson({
            importBatchId: batch.id,
            fileSha256: input.sha256,
            omegaExternalId: invoice.externalId,
            rawHeader: invoice.rawRow,
            rawItems: invoice.items.map((item) => item.rawRow),
            normalizedPartnerIco: invoice.partner.ico,
            rawPartnerIco: invoice.rawPartnerIco,
            assumedPaidAt: !invoice.paidAt && !!paidAt ? paidAt.toISOString() : null,
          }),
        },
      });
    }

    const counterTargets = new Map<string, { lastNumber: number; documentNumber: string }>();
    for (const invoice of input.parsed.invoices) {
      if (!/^\d{7}$/.test(invoice.omegaNumber)) {
        throw new Error(`Doklad ${invoice.invoiceNumber} nemá podporované sedemmiestne Omega číslo.`);
      }
      const year = Number(invoice.omegaNumber.slice(0, 4));
      const lastNumber = Number(invoice.omegaNumber.slice(4));
      const kind = invoice.direction === "VYDANA" ? "VYDANA" : "PRIJATA";
      const counterId = `${kind}-${year}`;
      const current = counterTargets.get(counterId);
      if (!current || lastNumber > current.lastNumber) {
        counterTargets.set(counterId, { lastNumber, documentNumber: invoice.invoiceNumber });
      }
    }

    for (const [counterId, target] of counterTargets) {
      const counter = await tx.docCounter.findUnique({ where: { id: counterId } });
      if (counter && counter.lastNumber > target.lastNumber) {
        throw new Error(
          `Číselný rad ${counterId} je už na ${counter.lastNumber}; import končiaci dokladom ${target.documentNumber} nie je bezpečný.`,
        );
      }
      await tx.docCounter.upsert({
        where: { id: counterId },
        create: { id: counterId, lastNumber: target.lastNumber },
        update: { lastNumber: target.lastNumber },
      });
    }

    await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMMITTED",
        completedAt: new Date(),
        summary: toJson({
          ...input.parsed.summary,
          paymentCount,
          issuedPaidDateStrategy: input.markIssuedPaid ? input.issuedPaidDateStrategy : null,
          warnings: input.parsed.warnings,
        }),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorEmail: input.actorEmail ?? null,
        action: "OMEGA_IMPORT_COMMITTED",
        entityType: "ImportBatch",
        entityId: batch.id,
        afterData: toJson({
          invoiceCount: input.parsed.summary.invoiceCount,
          paymentCount,
          totalGrossCents: input.parsed.summary.totalGrossCents,
        }),
        metadata: toJson({
          sha256: input.sha256,
          fileName: input.fileName,
          backupReference: input.backupReference,
        }),
      },
    });

    return {
      batchId: batch.id,
      alreadyCommitted: false,
      invoiceCount: input.parsed.summary.invoiceCount,
      paymentCount,
      nextIssuedNumber: input.parsed.summary.nextIssuedNumber,
    };
  });
}
