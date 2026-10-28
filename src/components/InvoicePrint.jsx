import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { AED } from "../lib/helpers";
import { emailInvoicePdf } from "../lib/storage";
import StripeLinkPanel from "./StripeLinkPanel";

const statusColor = {
  Draft: "#6B7280",
  Unpaid: "#B45309",
  Paid: "#047857",
  Refunded: "#6D28D9",
  Cancelled: "#B91C1C",
};

const statusBg = {
  Draft: "#F3F4F6",
  Unpaid: "#FEF3E2",
  Paid: "#E3F5EC",
  Refunded: "#EEE8FB",
  Cancelled: "#FBE9E7",
};

export default function InvoicePrint({ invoice, onBack, backLabel, autoPrint = false, autoShare = false, showPaymentLink = false, showToast }) {
  const [payUrl, setPayUrl] = useState(invoice.stripeLinkUrl && Number(invoice.stripeLinkAmount) === Math.round(Number(invoice.total) * 100) ? invoice.stripeLinkUrl : "");
  const [sharing, setSharing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [receiptMode, setReceiptMode] = useState(false);
  // iPhone Safari only allows the share sheet straight from a tap, and building the PDF takes a moment.
  // So the PDF is prepared ahead of time and the tap shares the finished file immediately.
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfError, setPdfError] = useState(false);
  const building = useRef(null);
  useEffect(() => {
    if (!autoPrint) return undefined;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);
  // Browser print (Print / Save PDF, Ctrl P): if only the footer would spill onto a second page, tighten
  // the row spacing for this print. The class is removed again as soon as printing is done.
  useEffect(() => {
    const COMPACT = ["pdf-compact-1", "pdf-compact-2", "pdf-compact-3"];
    const before = () => {
      const sheet = document.querySelector(".invoice-sheet:not(.pdf-exporting)");
      if (!sheet) return;
      const level = chooseCompactLevelForPrint(sheet);
      if (level > 0) sheet.classList.add(`pdf-compact-${level}`);
    };
    const after = () => document.querySelectorAll(".invoice-sheet").forEach((el) => el.classList.remove(...COMPACT));
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const createPdfFile = async () => {
    const source = document.querySelector(".invoice-sheet");
    if (!source) throw new Error("Invoice is not ready");

    // Lay the sheet out for A4. If that would leave a last page holding nothing but the footer (the content
    // just fits), retry with slightly tighter spacing. If it still does not fit, keep the normal layout.
    let clone = null;
    let fitted = false;
    for (let level = 0; level <= MAX_COMPACT_LEVEL && !fitted; level += 1) {
      clone?.remove();
      clone = source.cloneNode(true);
      clone.classList.add("pdf-exporting");
      if (level > 0) clone.classList.add(`pdf-compact-${level}`);
      document.body.appendChild(clone);
      fitted = !paginateForPdf(clone).footerOnly;
    }
    if (!fitted) {
      clone.remove();
      clone = source.cloneNode(true);
      clone.classList.add("pdf-exporting");
      document.body.appendChild(clone);
      paginateForPdf(clone);
    }

    try {
      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = 210;
      const pageHeight = 297;
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      const image = canvas.toDataURL("image/jpeg", 0.95);

      let offset = 0;
      let page = 0;
      // Stop when only blank bottom margin is left, so a short invoice never gets an empty second page.
      while (offset < imageHeight - PAGE_SLACK_MM) {
        if (page > 0) pdf.addPage();
        pdf.addImage(image, "JPEG", 0, -offset, pageWidth, imageHeight, undefined, "FAST");
        offset += pageHeight;
        page += 1;
      }

      return new File(
        [pdf.output("blob")],
        `Alainprints_INV-${invoice.number}.pdf`,
        { type: "application/pdf" },
      );
    } finally {
      clone.remove();
    }
  };

  const prepare = () => {
    if (!building.current) {
      building.current = createPdfFile()
        .then((file) => { setPdfFile(file); setPdfError(false); return file; })
        .catch((error) => { building.current = null; setPdfError(true); throw error; });
    }
    return building.current;
  };

  useEffect(() => {
    // Rebuild whenever the invoice, receipt view or payment link changes what is on the sheet.
    setPdfFile(null);
    building.current = null;
    const timer = window.setTimeout(() => { prepare().catch(() => {}); }, 600);
    return () => window.clearTimeout(timer);
  }, [invoice, receiptMode, payUrl]);

  const emailPdf = async () => {
    if (emailing) return;
    const typed = window.prompt("Send this invoice as a PDF to which email?", invoice.customer?.email || "");
    const email = String(typed || "").trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast?.("That email does not look right"); return; }
    setEmailing(true);
    try { showToast?.(await emailInvoicePdf(invoice.id, email)); } catch (error) { showToast?.(error.message || "Email not sent"); }
    setEmailing(false);
  };

  const download = (file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const sharePdf = async () => {
    if (sharing) return;
    if (!pdfFile) {
      // Not finished yet: build it, then ask for one more tap (Safari needs a fresh tap to open the share sheet).
      setSharing(true);
      try { await prepare(); } catch { window.alert("Couldn't create the invoice PDF. Please use Print / Save PDF."); }
      setSharing(false);
      return;
    }
    const data = { title: `Invoice INV-${invoice.number}`, text: `Alainprints invoice INV-${invoice.number}`, files: [pdfFile] };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
      } else {
        download(pdfFile);
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      download(pdfFile);
    }
  };

  const subtotal = invoice.subtotal ?? invoice.total + (invoice.discount || 0);
  const status = invoice.status || "Unpaid";
  const accent = statusColor[status] || "#1F2937";

  return (
    <div>
      <div className="no-print invoice-toolbar" style={s.bar}>
        <button style={s.secondaryBtn} onClick={onBack}>← {backLabel}</button>
        <div style={s.toolbarButtons}>
          {status === "Paid" && <button style={s.receiptBtn} onClick={() => setReceiptMode((value) => !value)}>{receiptMode ? "Invoice view" : "Receipt view"}</button>}
          <button style={s.shareBtn} disabled={sharing} onClick={pdfError && !pdfFile ? () => { building.current = null; setSharing(true); prepare().catch(() => {}).finally(() => setSharing(false)); } : sharePdf}>{sharing || (!pdfFile && !pdfError) ? "Preparing PDF…" : pdfFile ? "Share PDF" : "Retry PDF"}</button>
          {invoice.id && <button style={s.receiptBtn} disabled={emailing} onClick={emailPdf}>{emailing ? "Sending…" : "Email PDF"}</button>}
          <button style={s.primaryBtn} onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      {autoShare && (
        <div className="no-print" style={{ maxWidth: 820, margin: "0 auto 14px", padding: 14, border: "1px solid #047857", borderRadius: 10, background: "#ECFDF5", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span style={{ color: "#065F46", fontWeight: 700 }}>{pdfFile ? "PDF is ready." : "Preparing the PDF…"}</span>
          <button style={s.shareBtn} disabled={!pdfFile} onClick={sharePdf}>Share PDF now</button>
        </div>
      )}

      {showPaymentLink && (invoice.status || "Unpaid") === "Unpaid" && (
        <div className="no-print" style={{ maxWidth: 820, margin: "0 auto 14px" }}>
          <StripeLinkPanel invoice={invoice} showToast={showToast} onLink={setPayUrl} />
        </div>
      )}

      <article className="invoice-sheet" style={s.sheet}>
        <div style={s.topBar}><span style={{ flex: 3, background: "#0F6B64" }} /><span style={{ flex: 1, background: "#C2571A" }} /></div>
        <header className="invoice-hero" style={s.hero}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src="/logo-round.png" alt="" width="68" height="68" style={{ borderRadius: "50%", flex: "0 0 auto" }} />
            <div>
              <div style={s.brand}>Alain Prints</div>
              <div style={s.brandSub}>3D FILAMENT &amp; HANDICRAFTS</div>
              <div style={s.legal}>Abu Dhabi, U.A.E. · Trade Licence No. CN-6362373</div>
            </div>
          </div>
          <div className="invoice-meta" style={s.invoiceMeta}>
            <div style={s.documentTitle}>{receiptMode ? "RECEIPT" : "INVOICE"}</div>
            <div style={s.metaLine}><span style={s.metaLabel}>No.</span> <strong>INV-{invoice.number}</strong></div>
            <div style={s.metaLine}><span style={s.metaLabel}>Date</span> <strong>{invoice.date}</strong></div>
            <div style={{ ...s.pill, color: accent, background: statusBg[status] || "#F3F4F6", borderColor: accent }}>{status.toUpperCase()}</div>
          </div>
        </header>

        <section className="invoice-info" style={s.infoGrid}>
          <div style={s.card}>
            <div style={s.sectionTitle}>BILLED TO</div>
            <div style={s.customerName}>{invoice.customer.name || "Walk-in customer"}</div>
            {invoice.customer.phone && <div style={s.customerDetail}>{invoice.customer.phone}</div>}
          </div>
          <div style={s.card}>
            <div style={s.sectionTitle}>DETAILS</div>
            <div style={s.detailRow}><span>Currency</span><strong>AED</strong></div>
            {invoice.dueDate && <div style={s.detailRow}><span>Payment terms</span><strong>Due {invoice.dueDate}</strong></div>}
            <div style={s.detailRow}><span>VAT</span><strong>Not VAT registered</strong></div>
            {status === "Paid" && (
              <>
                <div style={s.detailRow}><span>Paid on</span><strong>{invoice.paidDate || "Not recorded"}</strong></div>
                <div style={s.detailRow}><span>Method</span><strong>{invoice.paymentMethod || "Not recorded"}</strong></div>
                {invoice.paymentReference && <div style={s.detailRow}><span>Reference</span><strong>{invoice.paymentReference}</strong></div>}
              </>
            )}
          </div>
        </section>

        <table className="invoice-table" style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: 44, textAlign: "center", borderTopLeftRadius: 10 }}>#</th>
              <th style={s.th}>DESCRIPTION</th>
              <th style={{ ...s.th, width: 64, textAlign: "center" }}>QTY</th>
              <th style={{ ...s.th, width: 112, textAlign: "right" }}>UNIT PRICE</th>
              <th style={{ ...s.th, width: 118, textAlign: "right", borderTopRightRadius: 10 }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr className="invoice-line" key={line.itemId || index} style={{ background: index % 2 ? "#FBF9F4" : "#fff" }}>
                <td style={{ ...s.td, textAlign: "center", color: "#9A917F" }}>{index + 1}</td>
                <td style={{ ...s.td, fontWeight: 700, color: "#15232B" }}>{line.name}</td>
                <td style={{ ...s.td, textAlign: "center" }}>{line.qty}</td>
                <td style={{ ...s.td, textAlign: "right" }}>{AED(line.price)}</td>
                <td style={{ ...s.td, textAlign: "right", fontWeight: 800, color: "#15232B" }}>{AED(line.price * line.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="invoice-summary" style={s.summaryWrap}>
          <div className="invoice-summary-box" style={s.summary}>
            <div style={s.summaryRow}><span>Subtotal</span><span>{AED(subtotal)}</span></div>
            {(invoice.discount || 0) > 0 && <div style={s.summaryRow}><span>Discount</span><span>- {AED(invoice.discount)}</span></div>}
            <div style={s.summaryRow}><span>VAT</span><span>Not charged</span></div>
            <div style={s.totalRow}><span>TOTAL</span><span>{AED(invoice.total)}</span></div>
            <div style={{ ...s.statusLine, color: accent }}>
              {status === "Paid" ? `✓ Paid in full${invoice.paidDate ? ` on ${invoice.paidDate}` : ""}` : status === "Unpaid" ? `Amount due: ${AED(invoice.total)}` : status === "Refunded" ? "Refunded" : status === "Cancelled" ? "Cancelled" : ""}
            </div>
          </div>
        </section>

        {payUrl && (invoice.status || "Unpaid") === "Unpaid" && (
          <section className="invoice-notes" style={{ ...s.notes, ...s.payBox }}>
            <div style={s.notesTitle}>PAY ONLINE BY CARD</div>
            <div style={{ wordBreak: "break-all", color: "#0F6B64", fontWeight: 700 }}>{payUrl}</div>
          </section>
        )}

        {invoice.notes && (
          <section className="invoice-notes" style={s.notes}>
            <div style={s.notesTitle}>NOTE</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{invoice.notes}</div>
          </section>
        )}

        <footer className="invoice-footer" style={s.footer}>
          <span style={{ fontWeight: 800, color: "#0F6B64", letterSpacing: 0.4 }}>Thank you for your business!</span>
          <span>printtools3d.com · Abu Dhabi, U.A.E. · Trade Licence No. CN-6362373</span>
        </footer>
      </article>
    </div>
  );
}

const s = {
  bar: { display: "flex", justifyContent: "space-between", margin: "0 auto 16px", maxWidth: 794 },
  toolbarButtons: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  receiptBtn: { background: "#fff", color: "#047857", border: "1px solid #047857", borderRadius: 8, padding: "10px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  shareBtn: { background: "#B9531A", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  primaryBtn: { background: "#16324f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  secondaryBtn: { background: "#fff", color: "#16324f", border: "1px solid #CBD5E1", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  sheet: { width: "210mm", minHeight: "297mm", margin: "0 auto", background: "#fff", color: "#3F4A52", boxShadow: "0 4px 24px rgba(15,23,42,0.12)", fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden", display: "flex", flexDirection: "column" },
  topBar: { display: "flex", height: 8 },
  hero: { padding: "30px 42px 26px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #E4DFD3" },
  brand: { fontSize: 26, fontWeight: 800, color: "#0F6B64", letterSpacing: 0.3 },
  brandSub: { fontSize: 10, letterSpacing: 3, marginTop: 6, color: "#C2571A", fontWeight: 700 },
  legal: { fontSize: 10.5, marginTop: 8, color: "#6B6355" },
  invoiceMeta: { textAlign: "right" },
  documentTitle: { fontSize: 30, fontWeight: 800, letterSpacing: 5, color: "#15232B", marginBottom: 12, lineHeight: 1 },
  metaLine: { fontSize: 12, marginTop: 6, color: "#15232B" },
  metaLabel: { color: "#6B6355", marginRight: 4 },
  pill: { display: "inline-block", marginTop: 12, padding: "4px 14px", border: "1.5px solid", borderRadius: 20, fontSize: 10.5, fontWeight: 800, letterSpacing: 2 },
  infoGrid: { display: "grid", gridTemplateColumns: "1.25fr 0.9fr", gap: 20, padding: "28px 42px 26px" },
  card: { background: "#F7F4EC", border: "1px solid #EBE5D6", borderRadius: 12, padding: "16px 18px" },
  sectionTitle: { fontSize: 10, fontWeight: 800, letterSpacing: 2.5, color: "#0F6B64", marginBottom: 12 },
  customerName: { fontSize: 15, fontWeight: 800, color: "#15232B" },
  customerDetail: { fontSize: 12.5, color: "#6B6355", marginTop: 8 },
  detailRow: { display: "flex", justifyContent: "space-between", gap: 14, fontSize: 11.5, color: "#6B6355", marginTop: 9 },
  table: { borderCollapse: "separate", borderSpacing: 0, width: "calc(100% - 84px)", margin: "0 42px" },
  th: { background: "#0F6B64", color: "#fff", textAlign: "left", padding: "12px 12px", fontSize: 10, letterSpacing: 2, fontWeight: 800 },
  td: { borderBottom: "1px solid #EEE9DD", padding: "14px 12px", fontSize: 12.5, verticalAlign: "top" },
  summaryWrap: { display: "flex", justifyContent: "flex-end", padding: "26px 42px 0" },
  summary: { width: 300, background: "#F7F4EC", border: "1px solid #EBE5D6", borderRadius: 12, padding: "16px 18px" },
  summaryRow: { display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5, color: "#6B6355" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "13px 14px", borderRadius: 9, background: "#0F6B64", color: "#fff", fontWeight: 800, letterSpacing: 1.5, fontSize: 15 },
  statusLine: { marginTop: 12, textAlign: "right", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4 },
  notes: { margin: "26px 42px 0", fontSize: 12, color: "#6B6355", lineHeight: 1.5 },
  payBox: { padding: "14px 16px", border: "1px dashed #0F6B64", borderRadius: 10, background: "#F1F8F6" },
  notesTitle: { color: "#0F6B64", fontWeight: 800, fontSize: 10, letterSpacing: 2.5, marginBottom: 8 },
  footer: { margin: "auto 42px 0", borderTop: "1px solid #E4DFD3", padding: "16px 0 26px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 9.5, color: "#6B6355" },
};

// The PDF is one tall image cut into A4 slices. Before taking the image, push any row or block
// that would be cut by a page edge down to the next page, and repeat the table header there.
// For browser print: which spacing level (0 = normal) keeps the footer on the same page as the content.
function chooseCompactLevelForPrint(source) {
  for (let level = 0; level <= MAX_COMPACT_LEVEL; level += 1) {
    const clone = source.cloneNode(true);
    clone.classList.add("pdf-exporting", "print-like");
    if (level > 0) clone.classList.add(`pdf-compact-${level}`);
    document.body.appendChild(clone);
    let spills = false;
    try {
      const pageHeight = (clone.offsetWidth * 297) / 210;
      const top = clone.getBoundingClientRect().top;
      const footer = clone.querySelector(".invoice-footer");
      let contentBottom = 0;
      clone.querySelectorAll(".invoice-hero, .invoice-info, .invoice-table, .invoice-summary, .invoice-notes").forEach((block) => {
        contentBottom = Math.max(contentBottom, block.getBoundingClientRect().bottom - top);
      });
      if (footer) {
        const footerBottom = footer.getBoundingClientRect().bottom - top;
        const contentPages = Math.max(1, Math.ceil(contentBottom / pageHeight));
        const footerPages = Math.max(1, Math.ceil((footerBottom - PAGE_SLACK_PX) / pageHeight));
        spills = footerPages > contentPages;
      }
    } finally {
      clone.remove();
    }
    if (!spills) return level;
  }
  return 0;
}

const MAX_COMPACT_LEVEL = 3; // how many times the PDF layout may tighten its spacing to avoid a footer-only page
const PAGE_SLACK_PX = 20; // blank space at the bottom of the sheet that never needs its own page
const PAGE_SLACK_MM = (PAGE_SLACK_PX * 210) / 794;

function paginateForPdf(sheet) {
  const pageHeight = (sheet.offsetWidth * 297) / 210;
  const topGap = 40; // breathing room at the top of continuation pages
  const sheetTop = () => sheet.getBoundingClientRect().top;
  const crossesPage = (element) => {
    const rect = element.getBoundingClientRect();
    const top = rect.top - sheetTop();
    const bottom = top + rect.height;
    return { top, height: rect.height, crosses: Math.floor(top / pageHeight) !== Math.floor((bottom - 1) / pageHeight) };
  };

  const headerRow = sheet.querySelector(".invoice-table thead tr");
  sheet.querySelectorAll(".invoice-table tbody tr.invoice-line").forEach((row) => {
    const { top, height, crosses } = crossesPage(row);
    if (!crosses || height >= pageHeight) return;
    const nextPageTop = Math.ceil(top / pageHeight) * pageHeight;
    const spacer = document.createElement("tr");
    spacer.className = "pdf-page-spacer";
    const cell = document.createElement("td");
    cell.colSpan = row.children.length;
    cell.style.cssText = `height:${nextPageTop - top + topGap}px;padding:0;border:none;background:#fff`;
    spacer.appendChild(cell);
    row.parentNode.insertBefore(spacer, row);
    if (headerRow) row.parentNode.insertBefore(headerRow.cloneNode(true), row);
  });

  sheet.querySelectorAll(".invoice-summary, .invoice-notes, .invoice-footer").forEach((block) => {
    const { top, height, crosses } = crossesPage(block);
    if (!crosses || height >= pageHeight) return;
    const nextPageTop = Math.ceil(top / pageHeight) * pageHeight;
    const current = parseFloat(window.getComputedStyle(block).marginTop) || 0;
    block.style.setProperty("margin-top", `${current + nextPageTop - top + topGap}px`, "important");
  });

  // Make the sheet a whole number of pages so the last page isn't a thin strip. A page is 1122.86px, so a
  // sheet that is a hair over (rounding) must still count as one page; the footer's own bottom padding
  // (26px) can safely absorb up to PAGE_SLACK of overflow.
  const total = sheet.scrollHeight;
  const pages = Math.max(1, Math.ceil((total - PAGE_SLACK_PX) / pageHeight));
  sheet.style.setProperty("min-height", `${pages * pageHeight - 1}px`, "important");

  // Report whether the last page would carry only the footer, so the caller can try a tighter layout.
  let contentBottom = 0;
  sheet.querySelectorAll(".invoice-hero, .invoice-info, .invoice-table, .invoice-summary, .invoice-notes").forEach((block) => {
    contentBottom = Math.max(contentBottom, block.getBoundingClientRect().bottom - sheetTop());
  });
  return { footerOnly: pages > 1 && contentBottom <= (pages - 1) * pageHeight + 1 };
}
