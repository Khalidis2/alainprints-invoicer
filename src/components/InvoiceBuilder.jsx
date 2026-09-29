import { useEffect, useRef, useState } from "react";
import { AED, today, CAT_STYLE } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";

export default function InvoiceBuilder({ items, customers = [], filaments = [], invoiceNo, initialInvoice, onSave, onFinished, onCancel, showToast }) {
  const editing = Boolean(initialInvoice);
  const [customer, setCustomer] = useState(initialInvoice?.customer ?? { name: "", phone: "" });
  const [lines, setLines] = useState(initialInvoice?.lines ?? []);
  const [notes, setNotes] = useState(initialInvoice?.notes ?? "");
  const [customInvoiceNo, setCustomInvoiceNo] = useState(String(initialInvoice?.number ?? invoiceNo));
  const [invoiceDate, setInvoiceDate] = useState(initialInvoice?.date ?? today());
  const [dueDate, setDueDate] = useState(initialInvoice?.dueDate ?? "");
  const [status, setStatus] = useState(initialInvoice?.status ?? "Unpaid");
  const [paymentMethod, setPaymentMethod] = useState(initialInvoice?.paymentMethod ?? "");
  const [paidDate, setPaidDate] = useState(initialInvoice?.paidDate ?? "");
  const [paymentReference, setPaymentReference] = useState(initialInvoice?.paymentReference ?? "");
  const [discountInput, setDiscountInput] = useState(initialInvoice?.discount ? String(initialInvoice.discount) : "");
  const [finalized, setFinalized] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

  const addItem = (item) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { itemId: item.id, name: item.name, price: item.price, qty: 1, filamentId: item.filamentId || null, gramsPerUnit: Number(item.gramsPerUnit || 0) }];
    });
  };
  const normalizeVoiceText = (value) => String(value || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const availableFilaments = filaments.filter((filament) => filament.stockStatus === "available" && Number(filament.remainingG || 0) >= Number(filament.spoolWeightG || 1000));

  const voiceQuantity = (transcript) => {
    const match = normalizeVoiceText(transcript).match(/\b(\d+)\b/);
    if (match) return Math.max(1, Number(match[1]));
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    return Object.entries(words).find(([word]) => normalizeVoiceText(transcript).split(" ").includes(word))?.[1] || 1;
  };

  const addFilamentSpool = (filament, requestedQty) => {
    const spoolWeightG = Number(filament.spoolWeightG || 1000);
    const availableQty = Math.floor(Number(filament.remainingG || 0) / spoolWeightG);
    if (availableQty < 1) {
      showToast(`${filament.material} ${filament.color} is no longer available`);
      return;
    }

    const itemId = `filament-spool:${filament.id}`;
    const lineName = `${filament.brand ? `${filament.brand} · ` : ""}${filament.material} ${filament.color} filament spool`;
    setLines((previous) => {
      const existing = previous.find((line) => line.itemId === itemId);
      const currentQty = Number(existing?.qty || 0);
      const nextQty = Math.min(currentQty + requestedQty, availableQty);
      if (existing) return previous.map((line) => line.itemId === itemId ? { ...line, qty: nextQty } : line);
      return [...previous, {
        itemId,
        name: lineName,
        price: Number(filament.sellingPrice || 0),
        qty: Math.min(requestedQty, availableQty),
        filamentId: filament.id,
        gramsPerUnit: spoolWeightG,
      }];
    });
    showToast(`Added ${Math.min(requestedQty, availableQty)} × ${filament.material} ${filament.color} spool to this invoice`);
  };

  const handleVoiceResult = (transcript) => {
    setVoiceTranscript(transcript);
    const spoken = normalizeVoiceText(transcript);
    const matches = availableFilaments.filter((filament) => {
      const requiredWords = `${filament.material} ${filament.color}`
        .split(/\s+/)
        .map(normalizeVoiceText)
        .filter((word) => word.length > 1);
      return requiredWords.every((word) => spoken.split(" ").includes(word));
    });

    if (matches.length !== 1) {
      showToast(matches.length > 1 ? "Say the exact material and colour, for example: add 1 PETG Blue spool" : "No matching available filament found");
      return;
    }
    addFilamentSpool(matches[0], voiceQuantity(transcript));
  };

  const startVoiceAdd = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Voice input is not supported in this browser. Use Chrome or Safari on a secure connection.");
      return;
    }

    recognitionRef.current?.abort?.();
    const recognition = new Recognition();
    recognition.lang = "en-AE";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onerror = () => {
      setListening(false);
      showToast("Couldn't hear that. Try again: add 1 PETG Blue spool.");
    };
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => handleVoiceResult(event.results[0][0].transcript);
    recognitionRef.current = recognition;
    recognition.start();
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
        paymentMethod: status === "Paid" ? paymentMethod : "",
        paidDate: status === "Paid" ? (paidDate || today()) : "",
        paymentReference: status === "Paid" ? paymentReference : "",
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
    setPaymentMethod("");
    setPaidDate("");
    setPaymentReference("");
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
    <div className="invoice-builder" style={s.layout}>
      <div>
        <h2 style={s.h2}>{editing ? `Edit invoice #${initialInvoice.number}` : "New invoice"}</h2>
        <div style={s.sub}>Invoice #{customInvoiceNo || "—"} · {invoiceDate} — tap items to add them.</div>

        <div style={s.voiceCard}>
          <div>
            <strong style={s.voiceTitle}>Voice add available filament spool</strong>
            <div style={s.voiceHelp}>Say: “add 2 PETG Blue spools”. Only Available stock can be matched.</div>
            {voiceTranscript && <div style={s.voiceTranscript}>Heard: {voiceTranscript}</div>}
          </div>
          <button type="button" style={s.voiceButton} onClick={startVoiceAdd} disabled={listening}>
            {listening ? "Listening…" : "🎙 Add spool by voice"}
          </button>
        </div>

        <div className="item-picker-grid" style={s.pickGrid}>
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

      <div className="invoice-panel" style={s.panel}>
        <div style={s.panelTitle}>Invoice #{customInvoiceNo || "—"} · {invoiceDate}</div>

        <label style={s.label}>Invoice number</label>
        <input type="number" min="1" step="1" style={s.input} value={customInvoiceNo} onChange={(e) => setCustomInvoiceNo(e.target.value)} />
        {!invoiceNumberIsValid && customInvoiceNo !== "" && <div style={s.error}>Enter a positive whole number.</div>}

        <div className="two-column-fields" style={s.fieldGrid}>
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
        <select
          style={s.input}
          value={status}
          onChange={(e) => {
            const next = e.target.value;
            setStatus(next);
            if (next === "Paid" && !paidDate) setPaidDate(today());
          }}
        >
          <option>Draft</option>
          <option>Unpaid</option>
          <option>Paid</option>
          <option>Cancelled</option>
        </select>

        <label style={s.label}>Saved customer</label>
        <select
          style={s.input}
          value=""
          onChange={(e) => {
            const saved = customers.find((entry) => entry.id === e.target.value);
            if (saved) setCustomer({ name: saved.name, phone: saved.phone });
          }}
        >
          <option value="">Select a returning customer…</option>
          {customers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{entry.phone ? ` · ${entry.phone}` : ""}
            </option>
          ))}
        </select>

        {status === "Paid" && (
          <div className="two-column-fields" style={s.fieldGrid}>
            <div>
              <label style={s.label}>Payment method</label>
              <select style={s.input} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="">Not recorded</option>
                <option>Cash</option>
                <option>Card</option>
                <option>Bank Transfer</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label style={s.label}>Paid date</label>
              <input type="date" style={s.input} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={s.label}>Payment reference (optional)</label>
              <input style={s.input} value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Transfer or card reference" />
            </div>
          </div>
        )}

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
              <div key={l.itemId} className="invoice-line-editor" style={s.lineRow}>
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

        <div className="invoice-actions" style={s.actionRow}>
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
  voiceCard: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 16, padding: 14, border: "1.5px solid #D8E5DF", borderRadius: 10, background: "#F4FAF7" },
  voiceTitle: { color: "#16324F", fontSize: 13 },
  voiceHelp: { marginTop: 4, color: "#6B6355", fontSize: 11.5, lineHeight: 1.4 },
  voiceTranscript: { marginTop: 6, color: "#047857", fontSize: 11.5, fontWeight: 700 },
  voiceButton: { flex: "0 0 auto", minHeight: 42, border: 0, borderRadius: 8, padding: "10px 13px", background: "#16324F", color: "#fff", fontWeight: 800, cursor: "pointer" },
};
