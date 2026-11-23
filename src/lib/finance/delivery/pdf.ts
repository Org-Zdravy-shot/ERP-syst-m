import type { DeliveryNote } from "@prisma/client";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { formatUnitPrice } from "@/lib/precise-price";
import { formatCents } from "@/lib/format";
import { financePartySnapshotSchema } from "@/lib/zod-schemas";
import { loadFontBytes, wrapText } from "../documents/pdf-renderer";
import { deliveryLinesSchema } from "./schema";

const width = 595.28;
const height = 841.89;
const margin = 42;
const content = width - 2 * margin;
const ink = rgb(0.15, 0.14, 0.13);
const muted = rgb(0.34, 0.32, 0.29);
const rule = rgb(0.82, 0.8, 0.76);
const yellow = rgb(0.99, 0.87, 0.22);
const date = new Intl.DateTimeFormat("sk-SK", { dateStyle: "medium", timeZone: "Europe/Bratislava" });
const quantity = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 6 });

type PrintDocument = Pick<DeliveryNote, "number" | "issuerSnapshot" | "counterpartySnapshot" | "lines" | "issueDate" | "deliveryDate" | "note" | "cancelledAt" | "deliveryAddress" | "supplierOrderNumber" | "buyerOrderNumber">;
type QuoteTotals = { totalNetCents: number; totalVatCents: number; totalGrossCents: number };

export async function renderDeliveryNotePdf(note: PrintDocument, showPrices: boolean, quote?: QuoteTotals): Promise<Uint8Array> {
  const parties = [
    financePartySnapshotSchema.parse(note.issuerSnapshot),
    financePartySnapshotSchema.parse(note.counterpartySnapshot),
  ];
  const goods = deliveryLinesSchema.parse(note.lines).filter(line => line.kind === "GOODS");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const title = `${quote ? "Cenová ponuka" : "Dodací list"} ${note.number}`;
  pdf.setTitle(title);
  const bytes = await loadFontBytes();
  const regular = await pdf.embedFont(bytes.regular, { subset: false });
  const bold = await pdf.embedFont(bytes.bold, { subset: false });

  function header(page: PDFPage, continuation: boolean) {
    page.drawRectangle({ x: margin, y: height - 49, width: 46, height: 5, color: yellow });
    page.drawText(title, { x: margin, y: height - 82, font: bold, size: continuation ? 16 : 23, color: ink });
    if (note.cancelledAt) page.drawText("ZRUŠENÝ", { x: width - 117, y: height - 80, font: bold, size: 10, color: rgb(0.64, 0.13, 0.1) });
    page.drawText(`Vystavenie ${date.format(note.issueDate)}    ${quote ? "Platnosť do" : "Dodanie"} ${date.format(note.deliveryDate)}`, {
      x: margin, y: height - 104, font: regular, size: 10, color: muted,
    });
    return height - 134;
  }

  function textBlock(page: PDFPage, text: string, x: number, top: number, max: number) {
    let cursor = top;
    for (const line of wrapText(text, regular, 10, max)) {
      page.drawText(line, { x, y: cursor, font: regular, size: 10, color: ink });
      cursor -= 15;
    }
    return cursor;
  }

  let page = pdf.addPage([width, height]);
  let cursor = header(page, false);
  const partyBottoms = parties.map((party, index) => {
    const x = margin + index * (content / 2 + 10);
    page.drawText(index === 0 ? "Dodávateľ" : "Odberateľ", { x, y: cursor, font: bold, size: 11, color: ink });
    let bottom = cursor - 18;
    for (const value of [party.name, party.street, [party.zip, party.city].filter(Boolean).join(" "),
      party.country === "SK" ? "" : party.country, party.ico && `IČO ${party.ico}`]) {
      if (value) bottom = textBlock(page, value, x, bottom, content / 2 - 20);
    }
    return bottom;
  });
  cursor = Math.min(...partyBottoms) - 12;
  for (const value of [
    note.deliveryAddress && `Miesto dodania  ${note.deliveryAddress}`,
    note.supplierOrderNumber && `Naša objednávka  ${note.supplierOrderNumber}`,
    note.buyerOrderNumber && `Objednávka odberateľa  ${note.buyerOrderNumber}`,
  ]) {
    if (value) cursor = textBlock(page, value, margin, cursor, content);
  }

  const qtyX = showPrices ? 367 : 428;
  function tableHeader(top: number) {
    page.drawRectangle({ x: margin, y: top - 19, width: content, height: 23, color: rgb(0.96, 0.95, 0.92) });
    page.drawText(quote ? "Položka ponuky" : "Dodaná položka", { x: margin + 8, y: top - 11, font: bold, size: 9, color: ink });
    page.drawText("Množstvo", { x: qtyX, y: top - 11, font: bold, size: 9, color: ink });
    if (showPrices) page.drawText("€/j. bez DPH", { x: 473, y: top - 11, font: bold, size: 9, color: ink });
    return top - 30;
  }

  cursor = tableHeader(cursor - 12);
  const noteLines = note.note ? wrapText(`Poznámka  ${note.note}`, regular, 10, content) : [];
  for (const [index, row] of goods.entries()) {
    const description = wrapText(row.productSku ? `${row.description} · ${row.productSku}` : row.description, regular, 10, qtyX - margin - 20);
    const amount = wrapText(`${quantity.format(row.quantity)} ${row.unit}`, regular, 10, (showPrices ? 470 : width - margin) - qtyX - 5);
    const rowHeight = 14 * Math.max(description.length, amount.length) + 10;
    const bottom = index === goods.length - 1 && !note.cancelledAt ? 145 + Math.min(noteLines.length, 5) * 15 : 84;
    if (cursor - rowHeight < bottom) {
      page = pdf.addPage([width, height]);
      cursor = tableHeader(header(page, true));
    }
    description.forEach((line, index) => page.drawText(line, { x: margin + 8, y: cursor - index * 14, font: regular, size: 10, color: ink }));
    amount.forEach((line, index) => page.drawText(line, { x: qtyX, y: cursor - index * 14, font: regular, size: 10, color: ink }));
    if (showPrices && row.unitPriceExact) {
      const price = formatUnitPrice(row.unitPriceExact);
      page.drawText(price, { x: width - margin - 8 - regular.widthOfTextAtSize(price, 10), y: cursor, font: regular, size: 10, color: ink });
    }
    cursor -= rowHeight;
    page.drawLine({ start: { x: margin, y: cursor + 11 }, end: { x: width - margin, y: cursor + 11 }, thickness: 0.5, color: rule });
  }
  if (noteLines.length) {
    cursor -= 16;
    for (const line of noteLines) {
      if (cursor < 90) { page = pdf.addPage([width, height]); cursor = header(page, true); }
      page.drawText(line, { x: margin, y: cursor, font: regular, size: 10, color: ink });
      cursor -= 15;
    }
  }
  if (quote) {
    if (cursor < 128) { page = pdf.addPage([width, height]); cursor = header(page, true); }
    cursor -= 17;
    for (const [label, value, emphasized] of [
      ["Základ", quote.totalNetCents, false], ["DPH", quote.totalVatCents, false], ["Celkom", quote.totalGrossCents, true],
    ] as const) {
      const font = emphasized ? bold : regular;
      const text = formatCents(value);
      page.drawText(label, { x: width - margin - 186, y: cursor, font, size: 10, color: ink });
      page.drawText(text, { x: width - margin - font.widthOfTextAtSize(text, 10), y: cursor, font, size: 10, color: ink });
      cursor -= 18;
    }
  } else if (!note.cancelledAt) {
    if (cursor < 129) { page = pdf.addPage([width, height]); cursor = header(page, true); }
    cursor -= 57;
    for (const [index, caption] of ["Odovzdal", "Prevzal"].entries()) {
      const x = margin + index * (content / 2 + 14);
      page.drawLine({ start: { x, y: cursor }, end: { x: x + 188, y: cursor }, thickness: 0.75, color: rule });
      page.drawText(caption, { x, y: cursor - 17, font: regular, size: 9, color: muted });
    }
  }

  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText(note.number, { x: margin, y: 34, font: regular, size: 8, color: muted });
    sheet.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 26, y: 34, font: regular, size: 8, color: muted });
  });
  return pdf.save();
}
