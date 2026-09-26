import { useState } from "react";
import { AED } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";

const STATUS_COLOR = {
  Draft: "#6B7280",
  Unpaid: "#B45309",
  Paid: "#047857",
  Cancelled: "#B91C1C",
};

export default function InvoiceHistory({ invoices, onEdit, onUpdate, onDelete, showToast }) {
  const [open, setOpen] = useState(null);
  const [workingId, setWorkingId] = useState(null);

  if (open) {
    return <InvoicePrint invoice={open} onBack={() => setOpen(null)} backLabel="Back to history" />;
  }

  const remove = async (invoice) => {
    if ((invoice.status || "Unpaid") !== "Draft") return;
    if (!window.confirm(`Delete draft invoice #${invoice.number}? This can't be undone.`)) return;
    setWorkingId(invoice.id);
    try {
      await onDelete(invoice.id);
      showToast("Draft deleted");
    } catch {
      showToast("Couldn't delete draft - check connection");
    } finally {
      setWorkingId(null);
    }
  };

  const cancel = async (invoice) => {
    const status = invoice.status || "Unpaid";
    if (!["Unpaid", "Paid"].includes(status)) return;
    const warning = status === "Paid"
      ? `Cancel paid invoice #${invoice.number}? Keep payment/refund evidence in the notes.`
      : `Cancel invoice #${invoice.number}?`;
    if (!window.confirm(warning)) return;
    setWorkingId(invoice.id);
    try {
      await onUpdate({ ...invoice, status: "Cancelled" });
      showToast("Invoice cancelled and retained in history");
    } catch {
      showToast("Couldn't cancel invoice - check connection");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div>
      <h2 style={s.h2}>Invoice history</h2>
      <div style={s.sub}>{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} saved</div>

      {invoices.length === 0 ? (
        <div style={s.empty}>No invoices yet - generate one from the New invoice tab.</div>
      ) : (
        <div style={s.list}>
          {invoices.map((invoice) => {
            const status = invoice.status || "Unpaid";
            const editable = ["Draft", "Unpaid"].includes(status);
            const deletable = status === "Draft";
            const cancellable = ["Unpaid", "Paid"].includes(status);
            const busy = workingId === invoice.id;

            return (
              <div key={invoice.id} style={s.row}>
                <button style={s.rowMain} onClick={() => setOpen(invoice)}>
                  <span style={s.no}>INV-{invoice.number}</span>
                  <span style={s.name}>{invoice.customer.name || "Walk-in"}</span>
                  <span style={s.date}>{invoice.date}</span>
                  <span style={{ ...s.status, color: STATUS_COLOR[status] || "#2E7D8C" }}>{status}</span>
                  <span style={s.total}>{AED(invoice.total)}</span>
                </button>
                {editable && <button style={s.editBtn} disabled={busy} onClick={() => onEdit(invoice)}>Edit</button>}
                {cancellable && <button style={s.cancelBtn} disabled={busy} onClick={() => cancel(invoice)}>Cancel</button>}
                {deletable && <button style={s.deleteBtn} disabled={busy} onClick={() => remove(invoice)}>Delete draft</button>}
                {!editable && !cancellable && <span style={s.locked}>Locked</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s = {
  h2: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { fontSize: 13, color: "#8A7F6D", marginTop: 4, marginBottom: 16 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  row: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 10, padding: "12px 14px" },
  rowMain: { flex: 1, display: "grid", gridTemplateColumns: "90px 1fr 90px 75px 90px", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontSize: 13 },
  no: { color: "#E8792D", fontWeight: 700 },
  name: { fontWeight: 700, color: "#1B2A3D" },
  date: { color: "#8A7F6D", fontSize: 12 },
  status: { fontSize: 11.5, fontWeight: 700 },
  total: { fontWeight: 800, textAlign: "right", color: "#1B2A3D" },
  editBtn: { background: "none", border: "none", color: "#2E7D8C", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  cancelBtn: { background: "none", border: "none", color: "#B45309", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  deleteBtn: { background: "none", border: "none", color: "#B3451D", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  locked: { color: "#8A7F6D", fontWeight: 700, fontSize: 11.5 },
};
