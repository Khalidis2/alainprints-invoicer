import { AED } from "../lib/helpers";

export default function InvoicePrint({ invoice, onBack, backLabel }) {
  return (
    <div>
      <div className="no-print" style={s.bar}>
        <button style={s.secondaryBtn} onClick={onBack}>
          ← {backLabel}
        </button>
        <button style={s.primaryBtn} onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div style={s.sheet}>
        <div style={s.headRow}>
          <div>
            <div style={s.brand}>alainprints</div>
            <div style={s.brandSub}>Al Ain, UAE</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={s.invNo}>INVOICE #{invoice.number}</div>
            <div style={s.date}>{invoice.date}</div>
          </div>
        </div>

        <div style={s.divider} />

        <div style={{ marginBottom: 20 }}>
          <div style={s.label}>Billed to</div>
          <div style={s.customerName}>{invoice.customer.name || "—"}</div>
          {invoice.customer.phone && <div style={s.customerSub}>{invoice.customer.phone}</div>}
        </div>

        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Item</th>
              <th style={{ ...s.th, textAlign: "center" }}>Qty</th>
              <th style={{ ...s.th, textAlign: "right" }}>Price</th>
              <th style={{ ...s.th, textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.itemId}>
                <td style={s.td}>{l.name}</td>
                <td style={{ ...s.td, textAlign: "center" }}>{l.qty}</td>
                <td style={{ ...s.td, textAlign: "right" }}>{AED(l.price)}</td>
                <td style={{ ...s.td, textAlign: "right" }}>{AED(l.price * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={s.totalRow}>
          <span>Total due</span>
          <span style={s.totalAmt}>{AED(invoice.total)}</span>
        </div>

        {invoice.notes && (
          <div style={{ marginTop: 20, fontSize: 13 }}>
            <div style={s.label}>Notes</div>
            <div>{invoice.notes}</div>
          </div>
        )}

        <div style={s.footer}>Thank you for supporting alainprints 🌴</div>
      </div>
    </div>
  );
}

const s = {
  bar: { display: "flex", justifyContent: "space-between", marginBottom: 16, maxWidth: 640, marginLeft: "auto", marginRight: "auto" },
  primaryBtn: { background: "#E8792D", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  secondaryBtn: { background: "#fff", color: "#1B2A3D", border: "1.5px solid #DCD5C6", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  sheet: { background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 14, padding: "34px 36px", maxWidth: 640, margin: "0 auto", boxShadow: "0 4px 24px rgba(27,42,61,0.06)" },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontWeight: 800, fontSize: 18, color: "#1B2A3D" },
  brandSub: { fontSize: 11.5, color: "#8A7F6D" },
  invNo: { fontWeight: 700, fontSize: 13, color: "#E8792D" },
  date: { fontSize: 11.5, color: "#8A7F6D", marginTop: 2 },
  divider: { borderTop: "2px solid #1B2A3D", margin: "20px 0" },
  label: { fontSize: 10.5, color: "#8A7F6D", letterSpacing: 0.6, marginBottom: 3 },
  customerName: { fontWeight: 700, fontSize: 15, color: "#1B2A3D" },
  customerSub: { fontSize: 12.5, color: "#6B6355" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: 10.5, color: "#8A7F6D", borderBottom: "1.5px solid #E4DFD3", padding: "0 0 8px" },
  td: { padding: "9px 0", borderBottom: "1px solid #F1EDE3", fontSize: 13.5, color: "#1B2A3D" },
  totalRow: { display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 12, borderTop: "2px solid #1B2A3D", fontWeight: 800, fontSize: 15, color: "#1B2A3D" },
  totalAmt: { color: "#E8792D", fontSize: 19 },
  footer: { marginTop: 30, textAlign: "center", fontSize: 11.5, color: "#8A7F6D" },
};
