import { AED } from "../lib/helpers";

const statusColor = {
  Draft: "#6B7280",
  Unpaid: "#B45309",
  Paid: "#047857",
  Cancelled: "#B91C1C",
};

export default function InvoicePrint({ invoice, onBack, backLabel }) {
  const subtotal = invoice.subtotal ?? invoice.total + (invoice.discount || 0);
  const status = invoice.status || "Unpaid";
  const accent = statusColor[status] || "#1F2937";

  return (
    <div>
      <div className="no-print invoice-toolbar" style={s.bar}>
        <button style={s.secondaryBtn} onClick={onBack}>← {backLabel}</button>
        <button style={s.primaryBtn} onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <article className="invoice-sheet" style={s.sheet}>
        <header className="invoice-hero" style={s.hero}>
          <div>
            <div style={s.brand}>ALAINPRINTS</div>
            <div style={s.brandSub}>3D FILAMENT HANDICRAFTS</div>
            <div style={s.legal}>Abu Dhabi, U.A.E. | Trade Licence No.: CN-6362373</div>
          </div>
          <div className="invoice-meta" style={s.invoiceMeta}>
            <div style={s.documentTitle}>INVOICE</div>
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