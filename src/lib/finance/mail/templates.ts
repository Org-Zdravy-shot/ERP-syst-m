/** Slovenské e-mailové šablóny pre faktúru a upomienku. */

function eur(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function dateSk(date: Date): string {
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
}

export interface InvoiceEmailData {
  invoiceNumber: string;
  documentType: "INVOICE" | "CREDIT_NOTE";
  clientName: string;
  totalGrossCents: number;
  variableSymbol?: string | null;
  iban?: string | null;
  dueDate: Date;
  issuerName: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInvoiceEmail(data: InvoiceEmailData): { subject: string; text: string; html: string } {
  const doc = data.documentType === "CREDIT_NOTE" ? "Dobropis" : "Faktúra";
  const subject = `${doc} ${data.invoiceNumber} — ${data.issuerName}`;

  const payLines =
    data.documentType === "INVOICE"
      ? [
          "",
          "Platobné údaje:",
          `• Suma na úhradu: ${eur(data.totalGrossCents)}`,
          data.iban ? `• IBAN: ${data.iban}` : null,
          data.variableSymbol ? `• Variabilný symbol: ${data.variableSymbol}` : null,
          `• Splatnosť: ${dateSk(data.dueDate)}`,
          "",
          "Pre rýchlu platbu použite QR kód na faktúre (PAY by square).",
        ].filter((l): l is string => l !== null)
      : [];

  const text = [
    `Dobrý deň,`,
    "",
    `v prílohe Vám posielame ${doc.toLowerCase()} ${data.invoiceNumber}.`,
    ...payLines,
    "",
    "Ďakujeme za spoluprácu.",
    data.issuerName,
  ].join("\n");

  const htmlPay =
    data.documentType === "INVOICE"
      ? `<table style="border-collapse:collapse;margin:12px 0;font-size:14px">
${[
  ["Suma na úhradu", eur(data.totalGrossCents)],
  data.iban ? ["IBAN", data.iban] : null,
  data.variableSymbol ? ["Variabilný symbol", data.variableSymbol] : null,
  ["Splatnosť", dateSk(data.dueDate)],
]
  .filter((r): r is [string, string] => r !== null)
  .map(
    ([k, v]) =>
      `<tr><td style="padding:2px 16px 2px 0;color:#78716c">${k}</td><td style="padding:2px 0;font-weight:600;color:#0c0a09">${escapeHtml(v)}</td></tr>`,
  )
  .join("\n")}
</table>
<p style="font-size:13px;color:#78716c">Pre rýchlu platbu použite QR kód na faktúre (PAY by square).</p>`
      : "";

  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0c0a09;line-height:1.5">
<p>Dobrý deň,</p>
<p>v prílohe Vám posielame ${doc.toLowerCase()} <strong>${escapeHtml(data.invoiceNumber)}</strong>.</p>
${htmlPay}
<p>Ďakujeme za spoluprácu.<br>${escapeHtml(data.issuerName)}</p>
</div>`;

  return { subject, text, html };
}

export function buildReminderEmail(data: InvoiceEmailData & { daysOverdue: number }): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Upomienka — neuhradená faktúra ${data.invoiceNumber}`;
  const text = [
    `Dobrý deň,`,
    "",
    `evidujeme neuhradenú faktúru ${data.invoiceNumber} po splatnosti (${dateSk(data.dueDate)}, ${data.daysOverdue} dní).`,
    "",
    `Suma na úhradu: ${eur(data.totalGrossCents)}`,
    data.iban ? `IBAN: ${data.iban}` : null,
    data.variableSymbol ? `Variabilný symbol: ${data.variableSymbol}` : null,
    "",
    "Ak ste faktúru medzičasom uhradili, považujte túto správu za bezpredmetnú.",
    "",
    "Ďakujeme,",
    data.issuerName,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0c0a09;line-height:1.5">
<p>Dobrý deň,</p>
<p>evidujeme <strong>neuhradenú faktúru ${escapeHtml(data.invoiceNumber)}</strong> po splatnosti (${dateSk(data.dueDate)}, ${data.daysOverdue} dní).</p>
<p>Suma na úhradu: <strong>${eur(data.totalGrossCents)}</strong>${data.variableSymbol ? ` · VS ${escapeHtml(data.variableSymbol)}` : ""}</p>
<p style="font-size:13px;color:#78716c">Ak ste faktúru medzičasom uhradili, považujte túto správu za bezpredmetnú.</p>
<p>Ďakujeme,<br>${escapeHtml(data.issuerName)}</p>
</div>`;

  return { subject, text, html };
}
