import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { AED } from "../lib/helpers";
import StripeLinkPanel from "./StripeLinkPanel";

const statusColor = {
  Draft: "#6B7280",
  Unpaid: "#B45309",
  Paid: "#047857",
  Refunded: "#6D28D9",
  Cancelled: "#B91C1C",
};

export default function InvoicePrint({ invoice, onBack, backLabel, autoPrint = false, autoShare = false, showPaymentLink = false, showToast }) {
  const [payUrl, setPayUrl] = useState(invoice.stripeLinkUrl && Number(invoice.stripeLinkAmount) === Math.round(Number(invoice.total) * 100) ? invoice.stripeLinkUrl : "");
  const [sharing, setSharing] = useState(false);
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
  const createPdfFile = async () => {
    const source = document.querySelector(".invoice-sheet");
    if (!source) throw new Error("Invoice is not ready");

    const clone = source.cloneNode(true);
    clone.classList.add("pdf-exporting");
    document.body.appendChild(clone);

    try {
      paginateForPdf(clone);
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
      while (offset < imageHeight) {
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
        <header className="invoice-hero" style={s.hero}>
          <div>
            <div style={s.brand}>ALAINPRINTS</div>
            <div style={s.brandSub}>3D FILAMENT HANDICRAFTS</div>
            <div style={s.legal}>Abu Dhabi, U.A.E. | Trade Licence No.: CN-6362373</div>
          </div>
          <div className="invoice-meta" style={s.invoiceMeta}>
            <div style={s.documentTitle}>{receiptMode ? "RECEIPT" : "INVOICE"}</div>
            <div style={s.metaLine}>Invoice No.: <strong>INV-{invoice.number}</strong></div>
            <div style={s.metaLine}>Date: <strong>{invoice.date}</strong></div>
          </div>
        </header>

        <section className="invoice-info" style={s.infoGrid}>
          <div>
            <div style={s.sectionTitle}>BILL TO</div>
            <div style={s.rule} />
            <div style={s.customerName}>{invoice.customer.name || "Walk-in customer"}</div>
            {invoice.customer.phone && <div style={s.customerDetail}>{invoice.customer.phone}</div>}
          </div>
          <div>
            <div style={s.sectionTitle}>DETAILS</div>
            <div style={s.rule} />
            <div style={s.detailRow}><span>Currency</span><strong>AED</strong></div>
            <div style={s.detailRow}><span>Payment Status</span><strong style={{ color: accent }}>{status.toUpperCase()}</strong></div>
            {invoice.dueDate && <div style={s.detailRow}><span>Payment Terms</span><strong>Due {invoice.dueDate}</strong></div>}
            <div style={s.detailRow}><span>VAT Status</span><strong>Not VAT registered</strong></div>
            {status === "Paid" && (
              <>
                <div style={s.detailRow}><span>Paid Date</span><strong>{invoice.paidDate || "Not recorded"}</strong></div>
                <div style={s.detailRow}><span>Payment Method</span><strong>{invoice.paymentMethod || "Not recorded"}</strong></div>
                {invoice.paymentReference && <div style={s.detailRow}><span>Reference</span><strong>{invoice.paymentReference}</strong></div>}
              </>
            )}
          </div>
        </section>

        <table className="invoice-table" style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: 48 }}>#</th>
              <th style={s.th}>DESCRIPTION</th>
              <th style={{ ...s.th, width: 70, textAlign: "center" }}>QTY</th>
              <th style={{ ...s.th, width: 118, textAlign: "right" }}>UNIT PRICE</th>
              <th style={{ ...s.th, width: 120, textAlign: "right" }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr className="invoice-line" key={line.itemId || index}>
                <td style={{ ...s.td, textAlign: "center" }}>{index + 1}</td>
                <td style={{ ...s.td, fontWeight: 700 }}>{line.name}</td>
                <td style={{ ...s.td, textAlign: "center" }}>{line.qty}</td>
                <td style={{ ...s.td, textAlign: "right" }}>{AED(line.price)}</td>
                <td style={{ ...s.td, textAlign: "right", fontWeight: 700 }}>{AED(line.price * line.qty)}</td>
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
          </div>
        </section>

        {payUrl && (invoice.status || "Unpaid") === "Unpaid" && (
          <section className="invoice-notes" style={s.notes}>
            <div style={s.notesTitle}>PAY ONLINE BY CARD</div>
            <div style={{ wordBreak: "break-all", color: "#3B3599", fontWeight: 700 }}>{payUrl}</div>
          </section>
        )}

        {invoice.notes && (
          <section className="invoice-notes" style={s.notes}>
            <div style={s.notesTitle}>NOTE</div>
            <div>{invoice.notes}</div>
          </section>
        )}

        <footer className="invoice-footer" style={s.footer}>
          <span>3D FILAMENT HANDICRAFTS | Abu Dhabi, U.A.E. | Trade Licence No.: CN-6362373</span>
          <span>Alainprints</span>
        </footer>
      </article>
    </div>
  );
}

const s = {
  bar: { display: "flex", justifyContent: "space-between", margin: "0 auto 16px", maxWidth: 794 },
  toolbarButtons: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  receiptBtn: { background: "#fff", color: "#047857", border: "1px solid #047857", borderRadius: 8, padding: "10px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  shareBtn: { background: "#E8792D", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  primaryBtn: { background: "#16324f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  secondaryBtn: { background: "#fff", color: "#16324f", border: "1px solid #CBD5E1", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  sheet: { width: "210mm", minHeight: "297mm", margin: "0 auto", background: "#fff", color: "#1F2937", boxShadow: "0 4px 24px rgba(15,23,42,0.12)", fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden" },
  hero: { minHeight: 150, background: "#16324f", color: "#fff", padding: "35px 42px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 28, fontWeight: 800, letterSpacing: 5 },
  brandSub: { fontSize: 11, letterSpacing: 3.5, marginTop: 12 },
  legal: { fontSize: 11.5, letterSpacing: 0.6, marginTop: 14, opacity: 0.95 },
  invoiceMeta: { textAlign: "right" },
  documentTitle: { fontSize: 21, fontWeight: 800, letterSpacing: 5, marginBottom: 20 },
  metaLine: { fontSize: 11.5, marginTop: 8, letterSpacing: 0.5 },
  infoGrid: { display: "grid", gridTemplateColumns: "1.25fr 0.9fr", gap: 46, padding: "42px 42px 38px" },
  sectionTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 3, color: "#1F2937" },
  rule: { height: 1, background: "#CBD5E1", margin: "10px 0 18px" },
  customerName: { fontSize: 14, fontWeight: 800, letterSpacing: 1.1, textTransform: "uppercase" },
  customerDetail: { fontSize: 12.5, color: "#475569", marginTop: 10 },
  detailRow: { display: "flex", justifyContent: "space-between", gap: 16, fontSize: 11.5, color: "#64748B", marginTop: 13 },
  table: { borderCollapse: "collapse", width: "calc(100% - 84px)", margin: "0 42px" },
  th: { background: "#16324f", color: "#fff", textAlign: "left", padding: "14px 12px", fontSize: 10.5, letterSpacing: 2, fontWeight: 800 },
  td: { border: "1px solid #CBD5E1", padding: "16px 12px", fontSize: 12.5, verticalAlign: "top" },
  summaryWrap: { display: "flex", justifyContent: "flex-end", padding: "38px 42px 0" },
  summary: { width: 300, background: "#EFF4F8", borderRadius: 10, padding: "20px 22px" },
  summaryRow: { display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12.5, color: "#64748B" },
  totalRow: { display: "flex", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: "1px solid #CBD5E1", color: "#16324f", fontWeight: 800, letterSpacing: 2, fontSize: 14 },
  notes: { margin: "42px 42px 0", fontSize: 12, color: "#475569" },
  notesTitle: { color: "#1F2937", fontWeight: 800, letterSpacing: 2, marginBottom: 8 },
  footer: { margin: "auto 42px 0", borderTop: "1px solid #CBD5E1", padding: "16px 0 28px", display: "flex", justifyContent: "space-between", fontSize: 9.5, letterSpacing: 0.8, color: "#64748B" },
};

// The PDF is one tall image cut into A4 slices. Before taking the image, push any row or block
// that would be cut by a page edge down to the next page, and repeat the table header there.
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

  // Make the sheet a whole number of pages so the last page isn't a thin strip.
  const total = sheet.scrollHeight;
  sheet.style.setProperty("min-height", `${Math.ceil(total / pageHeight) * pageHeight - 1}px`, "important");
}
