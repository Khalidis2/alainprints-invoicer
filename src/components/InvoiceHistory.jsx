import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";

const STATUSES = ["Draft", "Unpaid", "Paid", "Cancelled"];
const STATUS_COLOR = {
  Draft: "#6B7280",
  Unpaid: "#B45309",
  Paid: "#047857",
  Cancelled: "#B91C1C",
};
const STATUS_BG = {
  Draft: "#F3F4F6",
  Unpaid: "#FFF7ED",
  Paid: "#ECFDF5",
  Cancelled: "#FEF2F2",
};

export default function InvoiceHistory({ invoices, onEdit, onUpdate, onDelete, showToast }) {
  const [open, setOpen] = useState(null);
  const [workingId, setWorkingId] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const totals = useMemo(() => {
    const billable = invoices.filter((invoice) => ["Paid", "Unpaid"].includes(invoice.status || "Unpaid"));
    const paid = billable.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const unpaid = billable.filter((invoice) => (invoice.status || "Unpaid") === "Unpaid").reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    return { billed: paid + unpaid, paid, unpaid, count: billable.length };
  }, [invoices]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const status = invoice.status || "Unpaid";
      const matchesStatus = statusFilter === "All" || status === statusFilter;
      const searchable = `INV-${invoice.number} ${invoice.customer.name || ""} ${invoice.customer.phone || ""}`.toLowerCase();
      return matchesStatus && (!needle || searchable.includes(needle));
    });
  }, [invoices, query, statusFilter]);

  if (open) {
    return <InvoicePrint invoice={open} onBack={() => setOpen(null)} backLabel="Back to history" />;
  }

  const updateStatus = async (invoice, nextStatus) => {
    const currentStatus = invoice.status || "Unpaid";
    if (nextStatus === currentStatus || currentStatus === "Cancelled") return;
    if (nextStatus === "Cancelled" && !window.confirm(`Cancel invoice INV-${invoice.number}? It will remain permanently in history.`)) return;
    setWorkingId(invoice.id);
    try {
      await onUpdate({ ...invoice, status: nextStatus });
      showToast(`Invoice INV-${invoice.number} marked ${nextStatus}`);
    } catch {
      showToast("Couldn't update status - check connection");
    } finally {
      setWorkingId(null);
    }
  };

  const remove = async (invoice) => {
    if ((invoice.status || "Unpaid") !== "Draft") return;
    if (!window.confirm(`Delete draft INV-${invoice.number}? This can't be undone.`)) return;
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

  return (
    <div>
      <div style={s.headingRow}>
        <div>
          <h2 style={s.h2}>Invoice history</h2>
          <div style={s.sub}>{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} saved</div>
        </div>
      </div>

      <div style={s.summaryGrid}>
        <SummaryCard label="Total billed" value={AED(totals.billed)} accent="#16324F" />
        <SummaryCard label="Paid" value={AED(totals.paid)} accent="#047857" />
        <SummaryCard label="Outstanding" value={AED(totals.unpaid)} accent="#B45309" />
        <SummaryCard label="Active invoices" value={String(totals.count)} accent="#2E7D8C" />
      </div>

      <div style={s.toolbar}>
        <input
          style={s.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search invoice, customer or phone"
          aria-label="Search invoices"
        />
        <select style={s.filter} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option>All</option>
          {STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={s.empty}>No invoices match this search or filter.</div>
      ) : (
        <div style={s.list}>
          {filtered.map((invoice) => {
            const status = invoice.status || "Unpaid";
            const editable = ["Draft", "Unpaid"].includes(status);
            const deletable = status === "Draft";
            const locked = status === "Cancelled";
            const busy = workingId === invoice.id;

            return (
              <div key={invoice.id} style={s.row}>
                <button style={s.rowMain} onClick={() => setOpen(invoice)}>
                  <span style={s.no}>INV-{invoice.number}</span>
                  <span style={s.name}>{invoice.customer.name || "Walk-in"}</span>
                  <span style={s.date}>{invoice.date}</span>
                  <span style={s.total}>{AED(invoice.total)}</span>
                </button>

                <select
                  aria-label={`Status for invoice INV-${invoice.number}`}
                  style={{ ...s.statusSelect, color: STATUS_COLOR[status], background: STATUS_BG[status] }}
                  value={status}
                  disabled={busy || locked}
                  onChange={(event) => updateStatus(invoice, event.target.value)}
                >
                  {STATUSES.map((option) => <option key={option}>{option}</option>)}
                </select>

                {editable && <button style={s.editBtn} disabled={busy} onClick={() => onEdit(invoice)}>Edit</button>}
                {deletable && <button style={s.deleteBtn} disabled={busy} onClick={() => remove(invoice)}>Delete draft</button>}
                {locked && <span style={s.locked}>Locked</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={{ ...s.cardValue, color: accent }}>{value}</div>
    </div>
  );
}

const s = {
  headingRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  h2: { fontSize: 24, fontWeight: 800, margin: 0 },
  sub: { fontSize: 13, color: "#8A7F6D", marginTop: 4 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, margin: "18px 0" },
  card: { background: "#fff", border: "1px solid #E4DFD3", borderRadius: 12, padding: "15px 16px" },
  cardLabel: { color: "#8A7F6D", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 },
  cardValue: { marginTop: 6, fontSize: 20, fontWeight: 850 },
  toolbar: { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 160px", gap: 10, marginBottom: 14 },
  search: { width: "100%", padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff", color: "#1B2A3D", fontSize: 13.5 },
  filter: { width: "100%", padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff", color: "#1B2A3D", fontSize: 13.5, fontWeight: 700 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  row: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #E4DFD3", borderRadius: 10, padding: "11px 13px", boxShadow: "0 1px 2px rgba(27,42,61,.03)" },
  rowMain: { flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "90px minmax(120px,1fr) 95px 100px", gap: 10, alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontSize: 13 },
  no: { color: "#E8792D", fontWeight: 800 },
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700, color: "#1B2A3D" },
  date: { color: "#8A7F6D", fontSize: 12 },
  total: { fontWeight: 800, textAlign: "right", color: "#1B2A3D" },
  statusSelect: { width: 112, border: "1px solid #DCD5C6", borderRadius: 8, padding: "7px 8px", fontWeight: 800, fontSize: 11.5, cursor: "pointer" },
  editBtn: { background: "none", border: "none", color: "#2E7D8C", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  deleteBtn: { background: "none", border: "none", color: "#B3451D", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 },
  locked: { width: 46, color: "#8A7F6D", fontWeight: 700, fontSize: 11.5 },
};
