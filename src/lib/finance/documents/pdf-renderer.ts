import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
} from "pdf-lib";
import { DocumentGenerationError } from "./errors";
import { createPayBySquarePng } from "./pay-by-square";
import type { InvoicePdfData, InvoicePdfRenderer } from "./types";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const STONE_950 = rgb(0.11, 0.1, 0.09);
const STONE_700 = rgb(0.27, 0.25, 0.23);
const STONE_500 = rgb(0.47, 0.44, 0.42);
const STONE_300 = rgb(0.84, 0.81, 0.78);
const STONE_100 = rgb(0.96, 0.95, 0.94);
const BRAND = rgb(0.74, 0.86, 0.19);
const WHITE = rgb(1, 1, 1);

const eurFormatter = new Intl.NumberFormat("sk-SK", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const quantityFormatter = new Intl.NumberFormat("sk-SK", {
  maximumFractionDigits: 3,
});
const dateFormatter = new Intl.DateTimeFormat("sk-SK", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Bratislava",
});

interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface TableColumns {
  description: number;
  quantity: number;
  unitPrice: number;
  vat: number;
  total: number;
}

const TABLE_COLUMNS: TableColumns = {
  description: MARGIN,
  quantity: 292,
  unitPrice: 360,
  vat: 448,
  total: 500,
};

let fontBytesPromise:
  | Promise<{ regular: Uint8Array; bold: Uint8Array }>
  | undefined;

function loadFontBytes(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  fontBytesPromise ??= Promise.all([
    readFile(
      path.join(
        process.cwd(),
        "public/fonts/NotoSans-Regular.ttf",
      ),
    ),
    readFile(
      path.join(
        process.cwd(),
        "public/fonts/NotoSans-Bold.ttf",
      ),
    ),
  ]).then(([regular, bold]) => ({
    regular: new Uint8Array(regular),
    bold: new Uint8Array(bold),
  }));
  return fontBytesPromise;
}

function money(cents: number): string {
  return eurFormatter.format(cents / 100);
}

function quantity(value: number, unit: string): string {
  return `${quantityFormatter.format(value)} ${unit}`;
}

function date(value: Date): string {
  return dateFormatter.format(value);
}

function compactText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const normalized = compactText(text);
  if (font.widthOfTextAtSize(normalized, size) <= maxWidth) return normalized;

  const ellipsis = "…";
  let fitted = normalized;
  while (
    fitted.length > 0 &&
    font.widthOfTextAtSize(`${fitted}${ellipsis}`, size) > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted.trimEnd()}${ellipsis}`;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = compactText(text).split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const tokens = words.flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
    const chunks: string[] = [];
    let chunk = "";
    for (const character of word) {
      const candidate = `${chunk}${character}`;
      if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        chunks.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });

  const lines: string[] = [];
  let current = "";
  for (const word of tokens) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function drawRightText(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color = STONE_950,
): void {
  page.drawText(text, {
    x: right - font.widthOfTextAtSize(text, size),
    y,
    size,
    font,
    color,
  });
}

function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  fonts: PdfFonts,
): void {
  page.drawText(label, {
    x,
    y,
    size: 7.5,
    font: fonts.regular,
    color: STONE_500,
  });
  drawRightText(
    page,
    fitText(value, fonts.bold, 8.5, width * 0.64),
    x + width,
    y,
    fonts.bold,
    8.5,
  );
}

interface PartyTextLine {
  text: string;
  bold: boolean;
}

function partyLines(
  party: InvoicePdfData["issuer"],
  fonts: PdfFonts,
  width: number,
): PartyTextLine[] {
  const identifiers = [
    party.ico ? `IČO: ${party.ico}` : "",
    party.dic ? `DIČ: ${party.dic}` : "",
    party.icDph ? `IČ DPH: ${party.icDph}` : "",
  ].filter(Boolean);

  const source: PartyTextLine[] = [
    { text: party.name, bold: true },
    { text: party.street ?? "", bold: false },
    { text: [party.zip, party.city].filter(Boolean).join(" "), bold: false },
    { text: party.country, bold: false },
    ...identifiers.map((text) => ({ text, bold: false })),
    { text: party.email ?? "", bold: false },
    { text: party.phone ?? "", bold: false },
  ].filter((line) => line.text);

  const wrapped = source.flatMap((line) =>
    wrapText(
      line.text,
      line.bold ? fonts.bold : fonts.regular,
      line.bold ? 9.2 : 8.2,
      width - 24,
    ).map((text) => ({ text, bold: line.bold })),
  );
  if (wrapped.length > 12) {
    throw new DocumentGenerationError(
      `Identifikačné údaje subjektu ${party.name} sú príliš dlhé pre faktúru.`,
    );
  }
  return wrapped;
}

function drawPartyBox(
  page: PDFPage,
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: PartyTextLine[],
  fonts: PdfFonts,
): void {
  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    borderColor: STONE_300,
    borderWidth: 0.8,
    color: WHITE,
  });
  page.drawRectangle({
    x,
    y: y - 24,
    width,
    height: 24,
    color: STONE_100,
  });
  page.drawText(title.toUpperCase(), {
    x: x + 12,
    y: y - 16,
    size: 7.5,
    font: fonts.bold,
    color: STONE_500,
  });

  let lineY = y - 42;
  for (const line of lines) {
    page.drawText(line.text, {
      x: x + 12,
      y: lineY,
      size: line.bold ? 9.2 : 8.2,
      font: line.bold ? fonts.bold : fonts.regular,
      color: line.bold ? STONE_950 : STONE_700,
    });
    lineY -= line.bold ? 16 : 13;
  }
}

function drawDocumentHeader(
  page: PDFPage,
  data: InvoicePdfData,
  fonts: PdfFonts,
  continuation = false,
): number {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 11,
    width: PAGE_WIDTH,
    height: 11,
    color: BRAND,
  });
  page.drawText("ZDRAVÝ SHOT", {
    x: MARGIN,
    y: PAGE_HEIGHT - 55,
    size: 12,
    font: fonts.bold,
    color: STONE_950,
  });
  page.drawText(
    data.documentType === "CREDIT_NOTE" ? "DOBROPIS" : "FAKTÚRA",
    {
      x: MARGIN,
      y: PAGE_HEIGHT - 87,
      size: 25,
      font: fonts.bold,
      color: STONE_950,
    },
  );
  drawRightText(
    page,
    data.invoiceNumber,
    PAGE_WIDTH - MARGIN,
    PAGE_HEIGHT - 82,
    fonts.bold,
    16,
  );

  if (continuation) {
    page.drawText("Pokračovanie dokladu", {
      x: MARGIN,
      y: PAGE_HEIGHT - 112,
      size: 8,
      font: fonts.regular,
      color: STONE_500,
    });
    return PAGE_HEIGHT - 140;
  }

  const boxGap = 12;
  const boxWidth = (CONTENT_WIDTH - boxGap) / 2;
  const boxTop = PAGE_HEIGHT - 116;
  const issuerLines = partyLines(data.issuer, fonts, boxWidth);
  const counterpartyLines = partyLines(data.counterparty, fonts, boxWidth);
  const boxHeight = Math.max(
    116,
    38 + Math.max(issuerLines.length, counterpartyLines.length) * 13,
  );
  drawPartyBox(
    page,
    "Dodávateľ",
    MARGIN,
    boxTop,
    boxWidth,
    boxHeight,
    issuerLines,
    fonts,
  );
  drawPartyBox(
    page,
    "Odberateľ",
    MARGIN + boxWidth + boxGap,
    boxTop,
    boxWidth,
    boxHeight,
    counterpartyLines,
    fonts,
  );

  const detailsTop = boxTop - boxHeight - 24;
  const detailsWidth = (CONTENT_WIDTH - boxGap) / 2;
  drawLabelValue(
    page,
    "Dátum vystavenia",
    date(data.issueDate),
    MARGIN,
    detailsTop,
    detailsWidth,
    fonts,
  );
  if (data.documentType === "CREDIT_NOTE") {
    drawLabelValue(
      page,
      "Pôvodná faktúra",
      data.originalInvoiceNumber ?? "—",
      MARGIN,
      detailsTop - 51,
      detailsWidth,
      fonts,
    );
  }
  drawLabelValue(
    page,
    "Dátum dodania",
    date(data.tax.deliveryDate),
    MARGIN,
    detailsTop - 17,
    detailsWidth,
    fonts,
  );
  drawLabelValue(
    page,
    "Dátum splatnosti",
    date(data.dueDate),
    MARGIN,
    detailsTop - 34,
    detailsWidth,
    fonts,
  );

  const paymentX = MARGIN + detailsWidth + boxGap;
  drawLabelValue(
    page,
    "Variabilný symbol",
    data.variableSymbol ?? data.invoiceNumber,
    paymentX,
    detailsTop,
    detailsWidth,
    fonts,
  );
  drawLabelValue(
    page,
    "IBAN",
    data.issuer.iban ?? "—",
    paymentX,
    detailsTop - 17,
    detailsWidth,
    fonts,
  );
  drawLabelValue(
    page,
    "Mena",
    data.currency,
    paymentX,
    detailsTop - 34,
    detailsWidth,
    fonts,
  );

  return detailsTop - (data.documentType === "CREDIT_NOTE" ? 83 : 66);
}

function drawTableHeader(page: PDFPage, y: number, fonts: PdfFonts): number {
  page.drawRectangle({
    x: MARGIN,
    y: y - 18,
    width: CONTENT_WIDTH,
    height: 22,
    color: STONE_100,
  });
  const labels: Array<{ text: string; x: number; right?: number }> = [
    { text: "Popis", x: TABLE_COLUMNS.description + 7 },
    { text: "Množstvo", x: TABLE_COLUMNS.quantity, right: 345 },
    { text: "Cena/j.", x: TABLE_COLUMNS.unitPrice, right: 435 },
    { text: "DPH", x: TABLE_COLUMNS.vat, right: 485 },
    { text: "Spolu", x: TABLE_COLUMNS.total, right: PAGE_WIDTH - MARGIN - 7 },
  ];
  for (const label of labels) {
    if (label.right) {
      drawRightText(page, label.text, label.right, y - 10, fonts.bold, 7.2, STONE_500);
    } else {
      page.drawText(label.text, {
        x: label.x,
        y: y - 10,
        size: 7.2,
        font: fonts.bold,
        color: STONE_500,
      });
    }
  }
  return y - 24;
}

function drawTableRow(
  page: PDFPage,
  data: InvoicePdfData,
  line: InvoicePdfData["lines"][number],
  y: number,
  fonts: PdfFonts,
): number {
  const descriptionLines = wrapText(line.description, fonts.regular, 8.2, 230);
  if (descriptionLines.length > 30) {
    throw new DocumentGenerationError(
      `Popis položky ${line.lineNumber} je príliš dlhý pre faktúru.`,
    );
  }
  const rowHeight = Math.max(26, descriptionLines.length * 11 + 10);
  page.drawLine({
    start: { x: MARGIN, y: y - rowHeight },
    end: { x: PAGE_WIDTH - MARGIN, y: y - rowHeight },
    thickness: 0.5,
    color: STONE_300,
  });

  let descriptionY = y - 13;
  for (const descriptionLine of descriptionLines) {
    page.drawText(descriptionLine, {
      x: TABLE_COLUMNS.description + 7,
      y: descriptionY,
      size: 8.2,
      font: fonts.regular,
      color: STONE_950,
    });
    descriptionY -= 11;
  }

  const valueY = y - 14;
  drawRightText(
    page,
    quantity(line.quantity, line.unit),
    345,
    valueY,
    fonts.regular,
    8,
    STONE_700,
  );
  drawRightText(
    page,
    line.unitPriceExact ? `${line.unitPriceExact.replace(".", ",")} €` : money(line.unitPriceCents),
    435,
    valueY,
    fonts.regular,
    8,
    STONE_700,
  );
  drawRightText(
    page,
    `${line.vatRate} %`,
    485,
    valueY,
    fonts.regular,
    8,
    STONE_700,
  );
  drawRightText(
    page,
    money(line.totalGrossCents),
    PAGE_WIDTH - MARGIN - 7,
    valueY,
    fonts.bold,
    8.2,
  );

  if (data.tax.vatStatus === "NON_PAYER" || line.taxCategory === "EXEMPT") {
    page.drawText(data.tax.vatStatus === "NON_PAYER" ? "bez DPH" : "oslobodené od dane", {
      x: TABLE_COLUMNS.description + 7,
      y: y - rowHeight + 4,
      size: 6.5,
      font: fonts.regular,
      color: STONE_500,
    });
  }
  return y - rowHeight;
}

function vatSummary(data: InvoicePdfData): Array<{
  rate: number;
  netCents: number;
  vatCents: number;
}> {
  const groups = new Map<number, { netCents: number; vatCents: number }>();
  for (const line of data.lines) {
    const current = groups.get(line.vatRate) ?? { netCents: 0, vatCents: 0 };
    current.netCents += line.totalNetCents;
    current.vatCents += line.totalVatCents;
    groups.set(line.vatRate, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rate, totals]) => ({ rate, ...totals }));
}

async function drawTotalsAndPayment(
  pdfDoc: PDFDocument,
  page: PDFPage,
  data: InvoicePdfData,
  y: number,
  fonts: PdfFonts,
): Promise<void> {
  const summary = vatSummary(data);
  page.drawText(
    data.tax.vatStatus === "NON_PAYER" ? "REKAPITULÁCIA" : "REKAPITULÁCIA DPH",
    {
    x: MARGIN,
    y,
    size: 7.5,
    font: fonts.bold,
    color: STONE_500,
    },
  );
  let summaryY = y - 17;
  if (data.tax.vatStatus === "NON_PAYER") {
    page.drawText("Dodávateľ nie je platiteľom DPH.", {
      x: MARGIN,
      y: summaryY,
      size: 7.5,
      font: fonts.regular,
      color: STONE_700,
    });
    summaryY -= 14;
  } else {
    for (const row of summary) {
      const text = `${row.rate} % · základ ${money(row.netCents)} · DPH ${money(row.vatCents)}`;
      page.drawText(text, {
        x: MARGIN,
        y: summaryY,
        size: 7.5,
        font: fonts.regular,
        color: STONE_700,
      });
      summaryY -= 14;
    }
    if (data.lines.some((line) => line.taxCategory === "EXEMPT")) {
      page.drawText("Dodanie je oslobodené od dane.", {
        x: MARGIN,
        y: summaryY,
        size: 7.5,
        font: fonts.bold,
        color: STONE_700,
      });
      summaryY -= 14;
    }
  }

  const totalsX = 360;
  const totalsWidth = PAGE_WIDTH - MARGIN - totalsX;
  const totalRows: Array<[string, string, boolean]> = [
    ["Základ dane", money(data.totalNetCents), false],
    ["DPH", money(data.totalVatCents), false],
    [
      data.documentType === "CREDIT_NOTE" ? "Suma dobropisu" : "Na úhradu",
      money(data.totalGrossCents),
      true,
    ],
  ];
  let totalsY = y;
  for (const [label, value, emphasized] of totalRows) {
    if (emphasized) {
      page.drawRectangle({
        x: totalsX - 10,
        y: totalsY - 8,
        width: totalsWidth + 10,
        height: 28,
        color: BRAND,
      });
    }
    page.drawText(label, {
      x: totalsX,
      y: totalsY,
      size: emphasized ? 9 : 8,
      font: emphasized ? fonts.bold : fonts.regular,
      color: emphasized ? STONE_950 : STONE_500,
    });
    drawRightText(
      page,
      value,
      PAGE_WIDTH - MARGIN,
      totalsY,
      fonts.bold,
      emphasized ? 11 : 8.5,
    );
    totalsY -= emphasized ? 34 : 20;
  }

  const qrDataUrl = await createPayBySquarePng(data);
  if (qrDataUrl) {
    const qr = await pdfDoc.embedPng(qrDataUrl);
    const qrSize = 92;
    page.drawImage(qr, {
      x: MARGIN,
      y: Math.max(70, summaryY - qrSize - 4),
      width: qrSize,
      height: qrSize,
    });
    page.drawText("PAY by square", {
      x: MARGIN + qrSize + 12,
      y: Math.max(105, summaryY - 40),
      size: 8.5,
      font: fonts.bold,
      color: STONE_950,
    });
    page.drawText("Naskenujte v bankovej aplikácii", {
      x: MARGIN + qrSize + 12,
      y: Math.max(89, summaryY - 56),
      size: 7.2,
      font: fonts.regular,
      color: STONE_500,
    });
  }

  if (data.note) {
    const noteLines = wrapText(
      `Poznámka: ${data.note}`,
      fonts.regular,
      7,
      CONTENT_WIDTH,
    );
    if (noteLines.length <= 3) {
      let noteY = Math.max(48, Math.min(summaryY - 10, 78));
      for (const line of noteLines) {
        page.drawText(line, {
          x: MARGIN,
          y: noteY,
          size: 7,
          font: fonts.regular,
          color: STONE_500,
        });
        noteY -= 10;
      }
    } else {
      let notePage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let noteY = drawDocumentHeader(notePage, data, fonts, true);
      for (const line of noteLines) {
        if (noteY < 50) {
          notePage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          noteY = drawDocumentHeader(notePage, data, fonts, true);
        }
        notePage.drawText(line, {
          x: MARGIN,
          y: noteY,
          size: 7,
          font: fonts.regular,
          color: STONE_500,
        });
        noteY -= 11;
      }
    }
  }
}

function drawPageFooters(pdfDoc: PDFDocument, fonts: PdfFonts): void {
  const pages = pdfDoc.getPages();
  for (const [index, page] of pages.entries()) {
    page.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_WIDTH - MARGIN, y: 34 },
      thickness: 0.5,
      color: STONE_300,
    });
    page.drawText("Doklad vytvorený v ERP Zdravý Shot", {
      x: MARGIN,
      y: 20,
      size: 6.5,
      font: fonts.regular,
      color: STONE_500,
    });
    drawRightText(
      page,
      `Strana ${index + 1} / ${pages.length}`,
      PAGE_WIDTH - MARGIN,
      20,
      fonts.regular,
      6.5,
      STONE_500,
    );
  }
}

export class SlovakInvoicePdfRenderer implements InvoicePdfRenderer {
  async render(data: InvoicePdfData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = await loadFontBytes();
    const fonts: PdfFonts = {
      // Plný TTF je väčší, ale na rozdiel od subsetovania zachová kompletnú
      // Unicode mapu a slovenské glyfy aj v macOS/Windows PDF rendereroch.
      regular: await pdfDoc.embedFont(fontBytes.regular, { subset: false }),
      bold: await pdfDoc.embedFont(fontBytes.bold, { subset: false }),
    };

    pdfDoc.setTitle(
      `${data.documentType === "CREDIT_NOTE" ? "Dobropis" : "Faktúra"} ${data.invoiceNumber}`,
    );
    pdfDoc.setAuthor(data.issuer.name);
    pdfDoc.setCreator("Zdravý Shot ERP");
    pdfDoc.setProducer("Zdravý Shot ERP");
    pdfDoc.setSubject("Nemenný účtovný doklad");
    pdfDoc.setCreationDate(data.finalizedAt);
    pdfDoc.setModificationDate(data.finalizedAt);

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let tableY = drawDocumentHeader(page, data, fonts);
    tableY = drawTableHeader(page, tableY, fonts);

    for (const line of data.lines) {
      const descriptionLineCount = wrapText(
        line.description,
        fonts.regular,
        8.2,
        230,
      ).length;
      if (descriptionLineCount > 30) {
        throw new DocumentGenerationError(
          `Popis položky ${line.lineNumber} je príliš dlhý pre faktúru.`,
        );
      }
      const requiredHeight = Math.max(26, descriptionLineCount * 11 + 10);
      if (tableY - requiredHeight < 180) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        tableY = drawDocumentHeader(page, data, fonts, true);
        tableY = drawTableHeader(page, tableY, fonts);
      }
      if (tableY - requiredHeight < 42) {
        throw new DocumentGenerationError(
          `Popis položky ${line.lineNumber} sa nezmestí na samostatnú stranu.`,
        );
      }
      tableY = drawTableRow(page, data, line, tableY, fonts);
    }

    const summaryHeight = 165 + vatSummary(data).length * 14;
    if (tableY - summaryHeight < 42) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      tableY = drawDocumentHeader(page, data, fonts, true);
    }
    await drawTotalsAndPayment(pdfDoc, page, data, tableY - 20, fonts);
    drawPageFooters(pdfDoc, fonts);

    return pdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      objectsPerTick: 50,
    });
  }
}
