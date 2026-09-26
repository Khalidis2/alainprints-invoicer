import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";

export default function Customers({ customers, invoices, onUpdate, showToast }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return customers
      .filter((customer) => !needle || `${customer.name} ${customer.phone}`.toLocaleLowerCase().includes(needle))
      .map((customer) => {
        const digits = String(customer.phone || "").replace(/\D/g, "");
        const related = invoices.filter((invoice) => {
          const invoiceDigits = String(invoice.customer?.phone || "").replace(/\D/g, "");
          return digits
            ? invoiceDigits === digits
            : invoice.customer?.name?.trim().toLocaleLowerCase() === customer.name.trim().toLocaleLowerCase();
        });
        const paid = related
          .filter((invoice) => invoice.status === "Paid")
          .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
        const outstanding = related
          .filter((invoice) => (invoice.status || "Unpaid") === "Unpaid")
          .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
        return { ...customer, invoiceCount: related.length, paid, outstanding };
      });
  }, [customers, invoices, query]);

  const save = async () => {
    if (!editing?.name.trim()) return;
    setBusy(true);
    try {
      await onUpdate(editing);
      setEditing(null);
      showToast("Customer updated");
    } catch (error) {
      showToast(error.code === "23505" ? "A customer with this phone already exists" : "Couldn't update customer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div style={s.heading}>
        <div>
          <h2 style={s.title}>Customers</h2>
          <div style={s.sub}>{customers.length} saved customer{customers.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <input
        style={s.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by customer name or phone"
        aria-label="Search customers"
      />

      <div className="customer-grid" style={s.grid}>
        {rows.map((customer) => (
          <article key={customer.id} style={s.card}>
            <div style={s.cardHead}>
              <div>
                <div style={s.name}>{customer.name}</div>
                <div style={s.phone}>{customer.phone || "No phone number"}</div>
              </div>
              <button style={s.edit} onClick={() => setEditing({ ...customer })}>Edit</button>
            </div>
            <div style={s.metrics}>
              <Metric label="Invoices" value={String(customer.invoiceCount)} />
              <Metric label="Paid" value={AED(customer.paid)} color="#047857" />
              <Metric label="Outstanding" value={AED(customer.outstanding)} color="#B45309" />
            </div>
            {customer.notes && <div style={s.notes}>{customer.notes}</div>}
          </article>
        ))}
      </div>

      {rows.length === 0 && <div style={s.empty}>No customers match your search.</div>}

      {editing && (
        <div style={s.overlay} onClick={() => !busy && setEditing(null)}>
          <div className="customer-modal" style={s.modal} onClick={(event) => event.stopPropagation()}>
            <h3 style={s.modalTitle}>Edit customer</h3>
            <label style={s.label}>Name</label>
            <input style={s.input} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            <label style={s.label}>Phone</label>
            <input inputMode="tel" style={s.input} value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} />
            <label style={s.label}>Notes</label>
            <textarea style={{ ...s.input, minHeight: 80 }} value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} />
            <div className="modal-actions" style={s.actions}>
              <button style={s.cancel} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button style={s.save} disabled={busy || !editing.name.trim()} onClick={save}>{busy ? "Saving…" : "Save customer"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, color = "#16324F" }) {
  return (
    <div>
      <div style={s.metricLabel}>{label}</div>
      <div style={{ ...s.metricValue, color }}>{value}</div>
    </div>
  );
}

const s = {
  heading: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  title: { margin: 0, fontSize: 24, fontWeight: 800 },
  sub: { marginTop: 4, color: "#8A7F6D", fontSize: 13 },
  search: { width: "100%", margin: "18px 0 14px", padding: "11px 12px", border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff", color: "#1B2A3D" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  card: { background: "#fff", border: "1px solid #E4DFD3", borderRadius: 12, padding: 16 },
  cardHead: { display: "flex", justifyContent: "space-between", gap: 12 },
  name: { fontWeight: 800, fontSize: 16 },
  phone: { color: "#8A7F6D", fontSize: 12.5, marginTop: 4 },
  edit: { border: "none", background: "none", color: "#2E7D8C", fontWeight: 800, cursor: "pointer" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid #E4DFD3" },
  metricLabel: { color: "#8A7F6D", fontSize: 10.5, textTransform: "uppercase", fontWeight: 700 },
  metricValue: { marginTop: 5, fontSize: 14, fontWeight: 850 },
  notes: { marginTop: 14, padding: 10, borderRadius: 8, background: "#FAF8F4", color: "#6B6355", fontSize: 12.5 },
  empty: { padding: 30, textAlign: "center", color: "#8A7F6D", border: "1px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  overlay: { position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 10, background: "rgba(15,23,42,.52)" },
  modal: { width: "100%", maxWidth: 440, padding: 22, borderRadius: 14, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,.24)" },
  modalTitle: { margin: "0 0 14px", fontSize: 19 },
  label: { display: "block", margin: "12px 0 5px", color: "#6B6355", fontSize: 11.5, fontWeight: 700 },
  input: { width: "100%", padding: "10px 11px", border: "1px solid #DCD5C6", borderRadius: 8, color: "#1B2A3D", background: "#fff" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  cancel: { padding: "9px 14px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#1B2A3D", fontWeight: 700, cursor: "pointer" },
  save: { padding: "9px 14px", border: "none", borderRadius: 8, background: "#16324F", color: "#fff", fontWeight: 800, cursor: "pointer" },
};
