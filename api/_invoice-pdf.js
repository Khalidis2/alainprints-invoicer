import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { SITE_URL } from "./_store-shared.js";

// Builds the invoice PDF on the server (used for the receipt email after a Stripe-link payment).
// Same look as the PDF in the app: teal + orange, status pill, items table, totals box.
const TEAL = rgb(0.059, 0.42, 0.392);
const ORANGE = rgb(0.761, 0.341, 0.102);
const INK = rgb(0.082, 0.137, 0.169);
const MUTED = rgb(0.42, 0.388, 0.333);
const CARD = rgb(0.969, 0.957, 0.925);
const LINE = rgb(0.933, 0.914, 0.867);
const GREEN = rgb(0.016, 0.471, 0.341);

const W = 595.28;
const H = 841.89;
const M = 42;

const aed = (value) => `AED ${Number(value || 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Standard PDF fonts only cover Latin text. Anything else becomes "?" instead of breaking the PDF.
const safe = (value) => String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/−/g, "-").split("").map((ch) => (ch.charCodeAt(0) < 256 ? ch : "?")).join("");

function wrap(text, font, size, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of safe(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// invoice: { number, date, customerName, customerPhone, notes, total, discount, lines:[{name,qty,price}], status, paidDate, paymentMethod, paymentReference }
export async function buildInvoicePdf(invoice, { logo } = {}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logoImage = null;
  if (logo) {
    try { logoImage = await pdf.embedPng(logo); } catch { logoImage = null; }
  }

  let page;
  let y;
  const text = (value, x, yy, { size = 10, font = regular, color = INK, align = "left", spacing = 0 } = {}) => {
    const t = safe(value);
    const width = font.widthOfTextAtSize(t, size) + spacing * Math.max(0, t.length - 1);
    page.drawText(t, { x: align === "right" ? x - width : x, y: yy, size, font, color, characterSpacing: spacing });
  };

  const topBar = () => {
    page.drawRectangle({ x: 0, y: H - 7, width: W * 0.75, height: 7, color: TEAL });
    page.drawRectangle({ x: W * 0.75, y: H - 7, width: W * 0.25, height: 7, color: ORANGE });
  };

  const footer = () => {
    page.drawLine({ start: { x: M, y: 58 }, end: { x: W - M, y: 58 }, thickness: 0.7, color: LINE });
    text("Thank you for your business!", M, 40, { size: 8.5, font: bold, color: TEAL });
    text("printtools3d.com  |  Abu Dhabi, U.A.E.  |  Trade Licence No. CN-6362373", W - M, 40, { size: 7.5, color: MUTED, align: "right" });
  };

  const newPage = () => {
    page = pdf.addPage([W, H]);
    topBar();
    footer();
    y = H - 50;
  };

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 26, width: W - 2 * M, height: 26, color: TEAL });
    const hy = y - 17;
    text("#", M + 14, hy, { size: 7.5, font: bold, color: rgb(1, 1, 1), spacing: 1.5 });
    text("DESCRIPTION", M + 40, hy, { size: 7.5, font: bold, color: rgb(1, 1, 1), spacing: 1.5 });
    text("QTY", W - M - 215, hy, { size: 7.5, font: bold, color: rgb(1, 1, 1), spacing: 1.5, align: "right" });
    text("UNIT PRICE", W - M - 105, hy, { size: 7.5, font: bold, color: rgb(1, 1, 1), spacing: 1.5, align: "right" });
    text("AMOUNT", W - M - 12, hy, { size: 7.5, font: bold, color: rgb(1, 1, 1), spacing: 1.5, align: "right" });
    y -= 26;
  };

  // ---------- page 1: header ----------
  newPage();
  const logoSize = 52;
  const headTop = y;
  if (logoImage) page.drawImage(logoImage, { x: M, y: headTop - logoSize + 4, width: logoSize, height: logoSize });
  const brandX = M + (logoImage ? logoSize + 14 : 0);
  text("Alain Prints", brandX, headTop - 20, { size: 22, font: bold, color: TEAL });
  text("3D FILAMENT & HANDICRAFTS", brandX, headTop - 34, { size: 7.5, font: bold, color: ORANGE, spacing: 2 });
  text("Abu Dhabi, U.A.E.  |  Trade Licence No. CN-6362373", brandX, headTop - 47, { size: 8, color: MUTED });

  text("INVOICE", W - M, headTop - 22, { size: 26, font: bold, color: INK, align: "right", spacing: 3 });
  text(`No.  INV-${invoice.number}`, W - M, headTop - 40, { size: 9.5, font: bold, align: "right" });
  text(`Date  ${invoice.date}`, W - M, headTop - 54, { size: 9.5, font: bold, align: "right" });

  const status = String(invoice.status || "Paid");
  const pillColor = status === "Paid" ? GREEN : status === "Unpaid" ? ORANGE : MUTED;
  const pillText = status.toUpperCase();
  const pillWidth = bold.widthOfTextAtSize(pillText, 8) + 14 * 2 + 2 * pillText.length;
  page.drawRectangle({ x: W - M - pillWidth, y: headTop - 82, width: pillWidth, height: 18, borderColor: pillColor, borderWidth: 1.2, color: status === "Paid" ? rgb(0.89, 0.96, 0.925) : rgb(0.996, 0.953, 0.886) });
  text(pillText, W - M - pillWidth / 2 - (bold.widthOfTextAtSize(pillText, 8) + 2 * (pillText.length - 1)) / 2, headTop - 76, { size: 8, font: bold, color: pillColor, spacing: 2 });
  y = headTop - 100;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: LINE });
  y -= 22;

  // ---------- info cards ----------
  const details = [["Currency", "AED"], ["VAT", "Not VAT registered"]];
  if (String(invoice.status || "Paid") !== "Paid" && invoice.dueDate) details.push(["Payment terms", `Due ${invoice.dueDate}`]);
  if (String(invoice.status || "Paid") === "Paid") {
    details.push(["Paid on", invoice.paidDate || "Not recorded"], ["Method", invoice.paymentMethod || "Not recorded"]);
    if (invoice.paymentReference) details.push(["Reference", String(invoice.paymentReference)]);
  }
  const cardH = Math.max(70, 40 + details.length * 15);
  const leftW = (W - 2 * M) * 0.58 - 8;
  const rightW = (W - 2 * M) - leftW - 16;
  page.drawRectangle({ x: M, y: y - cardH, width: leftW, height: cardH, color: CARD, borderColor: LINE, borderWidth: 0.8 });
  page.drawRectangle({ x: M + leftW + 16, y: y - cardH, width: rightW, height: cardH, color: CARD, borderColor: LINE, borderWidth: 0.8 });
  text("BILLED TO", M + 14, y - 20, { size: 7.5, font: bold, color: TEAL, spacing: 2 });
  text(invoice.customerName || "Customer", M + 14, y - 40, { size: 12, font: bold });
  if (invoice.customerPhone) text(invoice.customerPhone, M + 14, y - 56, { size: 9.5, color: MUTED });
  text("DETAILS", M + leftW + 30, y - 20, { size: 7.5, font: bold, color: TEAL, spacing: 2 });
  details.forEach(([label, value], i) => {
    const ly = y - 38 - i * 15;
    text(label, M + leftW + 30, ly, { size: 8.5, color: MUTED });
    const maxW = rightW - 28 - 60;
    let v = safe(value);
    while (bold.widthOfTextAtSize(v, 8.5) > maxW && v.length > 4) v = v.slice(0, -1);
    text(v, M + leftW + 16 + rightW - 14, ly, { size: 8.5, font: bold, align: "right" });
  });
  y -= cardH + 24;

  // ---------- items ----------
  tableHeader();
  const lines = (invoice.lines || []).filter((line) => line && line.name);
  lines.forEach((line, index) => {
    const nameLines = wrap(line.name, bold, 10, W - 2 * M - 40 - 215 - 20);
    const rowH = Math.max(26, 14 + nameLines.length * 12);
    if (y - rowH < 130) {
      newPage();
      tableHeader();
    }
    if (index % 2) page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: rgb(0.984, 0.976, 0.957) });
    page.drawLine({ start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH }, thickness: 0.6, color: LINE });
    const ty = y - 17;
    text(String(index + 1), M + 14, ty, { size: 9, color: MUTED });
    nameLines.forEach((part, i) => text(part, M + 40, ty - i * 12, { size: 10, font: bold }));
    text(String(line.qty), W - M - 215, ty, { size: 10, align: "right" });
    text(aed(line.price), W - M - 105, ty, { size: 10, align: "right" });
    text(aed(Number(line.price) * Number(line.qty)), W - M - 12, ty, { size: 10, font: bold, align: "right" });
    y -= rowH;
  });

  // ---------- totals ----------
  const discount = Number(invoice.discount) || 0;
  const subtotal = Number(invoice.total) + discount;
  const boxW = 230;
  const rows = [["Subtotal", aed(subtotal)]];
  if (discount > 0) rows.push(["Discount", `- ${aed(discount)}`]);
  rows.push(["VAT", "Not charged"]);
  const boxH = 30 + rows.length * 17 + 48;
  if (y - boxH < 80) newPage();
  y -= 22;
  const bx = W - M - boxW;
  page.drawRectangle({ x: bx, y: y - boxH, width: boxW, height: boxH, color: CARD, borderColor: LINE, borderWidth: 0.8 });
  rows.forEach(([label, value], i) => {
    const ry = y - 24 - i * 17;
    text(label, bx + 16, ry, { size: 9.5, color: MUTED });
    text(value, bx + boxW - 16, ry, { size: 9.5, color: MUTED, align: "right" });
  });
  const totalY = y - 24 - rows.length * 17 - 22;
  page.drawRectangle({ x: bx + 12, y: totalY, width: boxW - 24, height: 30, color: TEAL });
  text("TOTAL", bx + 26, totalY + 10, { size: 10.5, font: bold, color: rgb(1, 1, 1), spacing: 1.5 });
  text(aed(invoice.total), bx + boxW - 26, totalY + 10, { size: 12, font: bold, color: rgb(1, 1, 1), align: "right" });
  if (status === "Paid") text(`Paid in full${invoice.paidDate ? ` on ${invoice.paidDate}` : ""}`, bx + boxW - 16, totalY - 16, { size: 8.5, font: bold, color: GREEN, align: "right" });
  else if (status === "Unpaid") text(`Amount due: ${aed(invoice.total)}`, bx + boxW - 16, totalY - 16, { size: 8.5, font: bold, color: ORANGE, align: "right" });
  y = y - boxH - 24;

  if (status === "Unpaid" && invoice.payUrl) {
    const urlLines = wrap(invoice.payUrl, regular, 8.5, W - 2 * M - 28);
    const blockH = 34 + urlLines.length * 11;
    if (y - blockH < 80) newPage();
    page.drawRectangle({ x: M, y: y - blockH, width: W - 2 * M, height: blockH, color: rgb(0.945, 0.973, 0.965), borderColor: TEAL, borderWidth: 0.8, borderDashArray: [3, 3] });
    text("PAY ONLINE BY CARD", M + 14, y - 18, { size: 7.5, font: bold, color: TEAL, spacing: 2 });
    urlLines.forEach((part, i) => text(part, M + 14, y - 32 - i * 11, { size: 8.5, color: TEAL }));
    y -= blockH + 18;
  }

  if (invoice.notes) {
    const noteLines = wrap(invoice.notes, regular, 9.5, W - 2 * M);
    if (y - 24 - noteLines.length * 13 < 80) newPage();
    text("NOTE", M, y, { size: 7.5, font: bold, color: TEAL, spacing: 2 });
    noteLines.forEach((part, i) => text(part, M, y - 16 - i * 13, { size: 9.5, color: MUTED }));
  }

  return Buffer.from(await pdf.save());
}

// Builds the PDF for a saved invoice row (as stored in the database). `overrides` can set status / paid details.
export async function invoicePdfFromRow(row, meta, overrides = {}) {
  let logo = null;
  try {
    const image = await fetch(`${SITE_URL}/logo-round.png`, { signal: AbortSignal.timeout(4000) });
    if (image.ok) logo = Buffer.from(await image.arrayBuffer());
  } catch { /* the PDF works without the logo */ }
  return buildInvoicePdf({
    number: row.number,
    date: row.date,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: row.notes,
    total: row.total,
    discount: meta.discount,
    dueDate: meta.dueDate,
    payUrl: meta.stripeLinkUrl,
    lines: (row.lines || []).filter((line) => line && line.itemId !== "__invoice_meta__" && line.itemId !== "__invoice_discount__"),
    status: meta.status || "Unpaid",
    paidDate: meta.paidDate,
    paymentMethod: meta.paymentMethod,
    paymentReference: meta.paymentReference,
    ...overrides,
  }, { logo });
}
