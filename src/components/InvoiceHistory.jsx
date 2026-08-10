import { useState } from "react";
import { AED } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";

export default function InvoiceHistory({ invoices }) {
  const [open, setOpen] = useState(null);

  if (open) {
    return <InvoicePrint invoice={open} onBack={() => setOpen(null)} backLabel="Back to history" />;
  }

  return (
    <div>
      <h2 style={s.h2}>Invoice history</h2>
      <div style={s.sub}>{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} saved</div>

      {invoices.length === 0 ? (
        <div style={s.empty}>No invoices yet — generate one from the New invoice tab.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {invoices.map((inv) => (
            <button key={inv.id} style={s.row} onClick={() => setOpen(inv)}>
              <span style={s.no}>#{inv.number}</span>
              <span style={s.name}>{inv.customer.name || "Walk-in"}</span>
              <span style={s.date}>{inv.date}</span>
              <span style={s.total}>{AED(inv.total)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  h2: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { fontSize: 13, color: "#8A7F6D", marginTop: 4, marginBottom: 16 },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  row: { display: "grid", gridTemplateColumns: "70px 1fr 90px 90px", alignItems: "center", background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 10, padding: "12px 14px", cursor: "pointer", textAlign: "left", fontSize: 13 },
  no: { color: "#E8792D", fontWeight: 700 },
  name: { fontWeight: 700, color: "#1B2A3D" },
  date: { color: "#8A7F6D", fontSize: 12 },
  total: { fontWeight: 800, textAlign: "right", color: "#1B2A3D" },
};
