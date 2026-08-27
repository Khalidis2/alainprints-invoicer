import { useState } from "react";
import { AED, today, CAT_STYLE } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";

export default function InvoiceBuilder({ items, invoiceNo, initialInvoice, onSave, onFinished, onCancel, showToast }) {
  const editing = Boolean(initialInvoice);
  const [customer, setCustomer] = useState(initialInvoice?.customer ?? { name: "", phone: "" });
  const [lines, setLines] = useState(initialInvoice?.lines ?? []);
  const [notes, setNotes] = useState(initialInvoice?.notes ?? "");
  const [customInvoiceNo, setCustomInvoiceNo] = useState(String(initialInvoice?.number ?? invoiceNo));
  const [invoiceDate, setInvoiceDate] = useState(initialInvoice?.date ?? today());
  const [dueDate, setDueDate] = useState(initialInvoice?.dueDate ?? "");
  const [status, setStatus] = useState(initialInvoice?.status ?? "Unpaid");
  const [discountInput, setDiscountInput] = useState(initialInvoice?.discount ? String(initialInvoice.discount) : "");
  const [finalized, setFinalized] = useState(null);
  const [generating, setGenerating] = useState(false);

  const addItem = (item) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { itemId: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  };
  const setQty = (itemId, qty) =>
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, qty: Math.max(1, Number(qty) || 1) } : l)));
  const setLine = (itemId, field, value) =>
    setLines((prev) =>
      prev.map((line) =>
        line.itemId === itemId
          ? { ...line, [field]: field === "price" ? Math.max(0, Number(value) || 0) : value }
          : line
      )
    );
  const removeLine = (itemId) => setLines((prev) => prev.filter((l) => l.itemId !== itemId));

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = Math.min(Math.max(0, Number(discountInput) || 0), subtotal);
  const total = subtotal - discount;
  const parsedInvoiceNo = Number(customInvoiceNo);
  const invoiceNumberIsValid = Number.isInteger(parsedInvoiceNo) && parsedInvoiceNo > 0;

  const generate = async () => {
    if (lines.length === 0 || !invoiceNumberIsValid) return;
    setGenerating(true);
    try {
      const saved = await onSave({
        id: initialInvoice?.id,
        number: parsedInvoiceNo,
        date: invoiceDate,
        dueDate,
        status,
        customer,
        lines,
        notes,
        discount,
        total,
      });
      setFinalized(saved);
      showToast(editing ? "Invoice updated" : "Invoice saved");
    } catch (e) {
      showToast(e.code === "23505" ? `Invoice #${parsedInvoiceNo} already exists` : "Couldn't save invoice — check connection");
    } finally {
      setGenerating(false);
    }
  };

  const startOver = () => {
    setFinalized(null);
    setCustomer({ name: "", phone: "" });
    setLines([]);
    setNotes("");
    setDiscountInput("");
    setCustomInvoiceNo(String(invoiceNo));
    setInvoiceDate(today());
    setDueDate("");
    setStatus("Unpaid");
  };

  if (finalized) {
    return (
      <InvoicePrint
        invoice={finalized}
        onBack={editing ? onFinished : startOver}
        backLabel={editing ? "Back to history" : "New invoice"}
      />
    );
  }

  return (
    <div style={s.layout}>
      <div>
        <h2 style={s.h2}>{editing ? `Edit invoice #${initialInvoice.number}` : "New invoice"}</h2>
        <div style={s.sub}>Invoice #{customInvoiceNo || "—"} · {invoiceDate} — tap items to add them.</div>

        <div style={s.pickGrid}>
          {items.map((item) => {
            const cs = CAT_STYLE[item.category] || CAT_STYLE.Custom;
            return (
              <button key={item.id} style={s.pickCard} onClick={() => addItem(item)}>
                {item.imageUrl && <img src={item.imageUrl} alt="" style={s.pickThumb} />}
                <span style={{ ...s.badge, color: cs.fg, background: cs.bg, alignSelf: "flex-start" }}>
                  {item.category}
                </span>
                <div style={s.pickName}>{item.name}</div>
                <div style={s.pickPrice}>{AED(item.price)}</div>
              </button>
            );
          })}
          {items.length === 0 && <div style={s.empty}>No items yet — add some in the Items menu tab first.</div>}
        </div>
      </div>

      <div style={s.panel}>
        <div style={s.panelTitle}>Invoice #{customInvoiceNo || "—"} · {invoiceDate}</div>

        <label style={s.label}>Invoice number</label>
        <input type="number" min="1" step="1" style={s.input} value={customInvoiceNo} onChange={(e) => setCustomInvoiceNo(e.target.value)} />
        {!invoiceNumberIsValid && customInvoiceNo !== "" && <div style={s.error}>Enter a positive whole number.</div>}

        <div style={s.fieldGrid}>
          <div>
            <label style={s.label}>Invoice date</label>
            <input type="date" style={s.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label style={s.label}>Due date (optional)</label>
            <input type="date" min={invoiceDate} style={s.input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <label style={s.label}>Status</label>
        <select style={s.input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>Draft</option>
          <option>Unpaid</option>
          <option>Paid</option>
          <option>Cancelled</option>
        </select>

        <label style={s.label}>Customer name</label>
        <input style={s.input} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Customer name" />
        <label style={s.label}>Phone / Instagram (optional)</label>
        <input style={s.input} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="+971…" />

        <div style={s.hr} />

        {lines.length === 0 ? (
          <div style={s.empty}>No items added yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lines.map((l) => (
              <div key={l.itemId} style={s.lineRow}>
                <div style={{ flex: 1 }}>
                  <input
                    aria-label="Item name"
                    style={s.lineNameInput}
                    value={l.name}
                    onChange={(e) => setLine(l.itemId, "name", e.target.value)}
                  />
                  <input
                    aria-label="Unit price"
                    type="number"
                    min="0"
                    step="0.01"
                    style={s.priceInput}
                    value={l.price}
                    onChange={(e) => setLine(l.itemId, "price", e.target.value)}
                  />
                </div>
                <input type="number" min="1" value={l.qty} onChange={(e) => setQty(l.itemId, e.target.value)} style={s.qtyInput} />
                <div style={s.lineTotal}>{AED(l.price * l.qty)}</div>
                <button style={s.removeBtn} onClick={() => removeLine(l.itemId)}>×</button>
              </div>
            ))}
          </div>
        )}

        <label style={s.label}>Discount (AED)</label>
        <input type="number" min="0" max={subtotal} step="0.01" style={s.input} value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} placeholder="0.00" />

        <label style={s.label}>Notes (optional)</label>
        <textarea style={{ ...s.input, minHeight: 50 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. pickup Thursday, custom color request" />

        <div style={s.summaryRow}><span>Subtotal</span><span>{AED(subtotal)}</span></div>
        {discount > 0 && <div style={s.summaryRow}><span>Discount</span><span>− {AED(discount)}</span></div>}
        <div style={s.totalRow}>
          <span>Total</span>
          <span style={s.totalAmt}>{AED(total)}</span>
        </div>

        <div style={s.actionRow}>
          {editing && <button style={s.secondaryBtn} disabled={generating} onClick={onCancel}>Cancel</button>}
          <button style={s.primaryBtn} disabled={lines.length === 0 || !customer.name || !invoiceNumberIsValid || !invoiceDate || generating} onClick={generate}>
            {generating ? "Saving…" : editing ? "Update invoice" : "Generate invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  layout: { display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 24, alignItems: "start" },
  h2: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { fontSize: 13, color: "#8A7F6D", marginTop: 4, marginBottom: 16 },
  pickGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10 },
  pickCard: { textAlign: "left", background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" },
  pickThumb: { width: "100%", height: 90, objectFit: "cover", borderRadius: 6, background: "#F1EDE3" },
  pickName: { fontWeight: 700, fontSize: 13, color: "#1B2A3D" },
  pickPrice: { fontSize: 12.5, color: "#8A7F6D" },
  badge: { fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 700 },
  panel: { background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 14, padding: 18, position: "sticky", top: 16 },
  panelTitle: { fontSize: 13, fontWeight: 700, color: "#E8792D", marginBottom: 4 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#8A7F6D", marginTop: 12, marginBottom: 5 },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: "1.5px solid #DCD5C6", fontSize: 14, background: "#fff", color: "#1B2A3D" },
  hr: { borderTop: "1.5px dashed #E4DFD3", margin: "14px 0" },
  lineRow: { display: "flex", alignItems: "center", gap: 8 },
  lineNameInput: { width: "100%", border: "none", borderBottom: "1px solid #E4DFD3", fontSize: 13, fontWeight: 700, color: "#1B2A3D", padding: "3px 0" },
  priceInput: { width: 90, border: "none", fontSize: 11, color: "#8A7F6D", padding: "3px 0" },
  qtyInput: { width: 44, padding: "6px 4px", textAlign: "center", borderRadius: 6, border: "1.5px solid #DCD5C6" },
  lineTotal: { width: 70, textAlign: "right", fontSize: 13, fontWeight: 700, color: "#1B2A3D" },
  removeBtn: { background: "none", border: "none", color: "#B3451D", fontSize: 18, cursor: "pointer", lineHeight: 1 },
  summaryRow: { display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13, color: "#6B6355" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 14, borderTop: "2px solid #1B2A3D", fontWeight: 700, fontSize: 14, color: "#1B2A3D" },
  totalAmt: { fontSize: 20, fontWeight: 800, color: "#E8792D" },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  actionRow: { display: "flex", gap: 8, marginTop: 16 },
  primaryBtn: { flex: 1, background: "#E8792D", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  secondaryBtn: { background: "#fff", color: "#1B2A3D", border: "1.5px solid #DCD5C6", borderRadius: 8, padding: "12px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  error: { marginTop: 4, color: "#B3451D", fontSize: 11.5 },
};
