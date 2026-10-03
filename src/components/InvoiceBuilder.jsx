import { useState } from "react";
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
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("all");

  const addItem = (item) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { itemId: item.id, name: item.name, price: item.price, qty: 1, filamentId: item.filamentId || null, gramsPerUnit: Number(item.gramsPerUnit || 0) }];
    });
  };
  const availableFilaments = filaments
    .filter((filament) => filament.stockStatus === "available")
    .map((filament) => ({
      ...filament,
      availableSpools: Math.floor(Number(filament.remainingG || 0) / Number(filament.spoolWeightG || 1000)),
    }))
    .filter((filament) => filament.availableSpools > 0);

  const addFilamentSpool = (filament) => {
    const itemId = `filament-spool:${filament.id}`;
    const spoolWeightG = Number(filament.spoolWeightG || 1000);
    const lineName = `${filament.brand ? `${filament.brand} · ` : ""}${filament.material} ${filament.color} filament spool`;

    setLines((previous) => {
      const existing = previous.find((line) => line.itemId === itemId);
      if (existing) {
        if (Number(existing.qty || 0) >= filament.availableSpools) {
          showToast(`Only ${filament.availableSpools} spool(s) available`);
          return previous;
        }
        return previous.map((line) => line.itemId === itemId ? { ...line, qty: Number(line.qty || 0) + 1 } : line);
      }
      return [...previous, {
        itemId,
        name: lineName,
        price: Number(filament.sellingPrice || 0),
        qty: 1,
        filamentId: filament.id,
        gramsPerUnit: spoolWeightG,
      }];
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
      const movesStock = ["Unpaid", "Paid"].includes(status) && lines.some((line) => line.filamentId);
      showToast(`${editing ? "Invoice updated" : "Invoice saved"}${movesStock ? " · stock updated on website" : ""}`);
    } catch (e) {
      showToast(e.code === "23505" ? `Invoice #${parsedInvoiceNo} already exists` : (e.message || "Couldn't save invoice — check connection"));
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

  const qtyInInvoice = (itemId) => lines.find((line) => line.itemId === itemId)?.qty || 0;
  const changeQty = (itemId, delta) =>
    setLines((prev) => prev.map((line) => (line.itemId === itemId ? { ...line, qty: Math.max(1, Number(line.qty || 1) + delta) } : line)));
  const increaseLine = (itemId) => {
    if (!String(itemId).startsWith("filament-spool:")) return changeQty(itemId, 1);
    const filament = availableFilaments.find((f) => `filament-spool:${f.id}` === itemId);
    if (!filament) return showToast("No more spools of this colour in stock");
    addFilamentSpool(filament);
  };
  const addCustomLine = () => {
    const itemId = `custom:${Date.now()}`;
    setLines((prev) => [...prev, { itemId, name: "Custom item", price: 0, qty: 1, filamentId: null, gramsPerUnit: 0 }]);
  };

  const query = search.trim().toLowerCase();
  const matches = (text) => !query || String(text || "").toLowerCase().includes(query);
  const productCategories = [...new Set(items.map((item) => item.category || "Custom"))];
  const shownProducts = items.filter((item) =>
    (section === "all" || section === (item.category || "Custom")) && (matches(item.name) || matches(item.category))
  );
  const shownSpools = (section === "all" || section === "spools")
    ? availableFilaments.filter((f) => matches(`${f.material} ${f.color} ${f.brand}`))
    : [];
  const spoolGroups = shownSpools.reduce((groups, filament) => {
    (groups[filament.material] ||= []).push(filament);
    return groups;
  }, {});
  const itemCount = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);

  const pickCustomerByName = (name) => {
    const saved = customers.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());
    setCustomer(saved ? { name: saved.name, phone: saved.phone || customer.phone } : { ...customer, name });
  };

  const sections = [
    { id: "all", label: "All" },
    ...productCategories.map((category) => ({ id: category, label: category })),
    { id: "spools", label: `Filament spools (${availableFilaments.length})` },
  ];

  return (
    <div className="invoice-builder" style={s.layout}>
      {/* LEFT: pick what you're selling */}
      <div style={{ minWidth: 0 }}>
        <h2 style={s.h2}>{editing ? `Edit invoice #${initialInvoice.number}` : "New invoice"}</h2>
        <div style={s.sub}>Tap anything to add it. Tap again to add one more.</div>
        {lines.length > 0 && (
          <a className="jump-to-bill" href="#invoice-bill">Review invoice · {itemCount} item{itemCount === 1 ? "" : "s"} · {AED(total)}</a>
        )}

        <input
          type="search"
          style={{ ...s.input, ...s.search }}
          placeholder="Search products, materials or colours…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="section-chips" style={s.chips} role="tablist" aria-label="Product type">
          {sections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={section === entry.id}
              style={{ ...s.chip, ...(section === entry.id ? s.chipActive : {}) }}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {shownProducts.length > 0 && (
          <div style={s.group}>
            <div style={s.groupTitle}>Printed &amp; custom products</div>
            <div className="item-picker-grid" style={s.pickGrid}>
              {shownProducts.map((item) => {
                const cs = CAT_STYLE[item.category] || CAT_STYLE.Custom;
                const inInvoice = qtyInInvoice(item.id);
                return (
                  <button key={item.id} type="button" style={{ ...s.pickCard, ...(inInvoice ? s.pickCardOn : {}) }} onClick={() => addItem(item)}>
                    {inInvoice > 0 && <span style={s.qtyBadge}>×{inInvoice}</span>}
                    {item.imageUrl && <img src={item.imageUrl} alt="" style={s.pickThumb} />}
                    <span style={{ ...s.badge, color: cs.fg, background: cs.bg, alignSelf: "flex-start" }}>{item.category}</span>
                    <div style={s.pickName}>{item.name}</div>
                    <div style={s.pickPrice}>{AED(item.price)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {Object.keys(spoolGroups).length > 0 && (
          <div style={{ ...s.group, ...s.filamentSection }}>
            <div style={s.groupTitle}>Filament spools</div>
            <div style={s.filamentSectionHelp}>Saving as Unpaid or Paid takes these spools out of stock and off the website.</div>
            {Object.entries(spoolGroups).map(([material, list]) => (
              <div key={material} style={{ marginTop: 10 }}>
                <div style={s.filamentMaterial}>{material}</div>
                <div className="item-picker-grid" style={s.spoolGrid}>
                  {list.map((filament) => {
                    const inInvoice = qtyInInvoice(`filament-spool:${filament.id}`);
                    const left = filament.availableSpools - inInvoice;
                    return (
                      <button
                        key={filament.id}
                        type="button"
                        style={{ ...s.filamentCard, ...(inInvoice ? s.pickCardOn : {}), ...(left <= 0 ? s.disabledCard : {}) }}
                        disabled={left <= 0}
                        onClick={() => addFilamentSpool(filament)}
                      >
                        {inInvoice > 0 && <span style={s.qtyBadge}>×{inInvoice}</span>}
                        <div style={s.pickName}>{filament.color}</div>
                        <div style={s.filamentStock}>{left} left · {AED(filament.sellingPrice)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {shownProducts.length === 0 && Object.keys(spoolGroups).length === 0 && (
          <div style={s.empty}>
            {items.length === 0 && availableFilaments.length === 0 ? "No products yet. Add them in the Products tab." : "Nothing matches. Try another word or tap All."}
          </div>
        )}

        <button type="button" style={s.customBtn} onClick={addCustomLine}>+ Add a custom line (one-off item or service)</button>
      </div>

      {/* RIGHT: the bill, top to bottom */}
      <div className="invoice-panel" id="invoice-bill" style={s.panel}>
        <div style={s.panelHead}>
          <span>Invoice #{customInvoiceNo || "—"}</span>
          <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
        </div>

        <div style={s.step}>1 · Customer</div>
        <input
          style={s.input}
          list="saved-customers"
          value={customer.name}
          onChange={(e) => pickCustomerByName(e.target.value)}
          placeholder="Customer name (saved ones appear as you type)"
          aria-label="Customer name"
        />
        <datalist id="saved-customers">
          {customers.map((entry) => <option key={entry.id} value={entry.name}>{entry.phone || ""}</option>)}
        </datalist>
        <input
          style={{ ...s.input, marginTop: 8 }}
          value={customer.phone}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
          placeholder="Phone or Instagram (optional)"
          aria-label="Phone or Instagram"
        />

        <div style={s.step}>2 · Items</div>
        {lines.length === 0 ? (
          <div style={s.emptySmall}>Nothing added yet. Tap a product or spool.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lines.map((l) => (
              <div key={l.itemId} className="invoice-line-editor" style={s.lineRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input aria-label="Item name" style={s.lineNameInput} value={l.name} onChange={(e) => setLine(l.itemId, "name", e.target.value)} />
                  <label style={s.priceLabel}>
                    AED
                    <input aria-label="Unit price" type="number" inputMode="decimal" min="0" step="0.01" style={s.priceInput} value={l.price} onChange={(e) => setLine(l.itemId, "price", e.target.value)} />
                    each
                  </label>
                </div>
                <div style={s.stepper}>
                  <button type="button" style={s.stepBtn} aria-label="One less" onClick={() => changeQty(l.itemId, -1)}>−</button>
                  <input type="number" inputMode="numeric" min="1" aria-label="Quantity" value={l.qty} onChange={(e) => setQty(l.itemId, e.target.value)} style={s.qtyInput} />
                  <button type="button" style={s.stepBtn} aria-label="One more" onClick={() => increaseLine(l.itemId)}>+</button>
                </div>
                <div style={s.lineTotal}>{AED(l.price * l.qty)}</div>
                <button type="button" style={s.removeBtn} aria-label="Remove" onClick={() => removeLine(l.itemId)}>×</button>
              </div>
            ))}
          </div>
        )}

        <div className="two-column-fields" style={{ ...s.fieldGrid, marginTop: 6 }}>
          <div>
            <label style={s.label}>Discount (AED)</label>
            <input type="number" inputMode="decimal" min="0" max={subtotal} step="0.01" style={s.input} value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={s.label}>Note (optional)</label>
            <input style={s.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pickup Thursday…" />
          </div>
        </div>

        <div style={s.summaryRow}><span>Subtotal</span><span>{AED(subtotal)}</span></div>
        {discount > 0 && <div style={s.summaryRow}><span>Discount</span><span>− {AED(discount)}</span></div>}
        <div style={s.totalRow}><span>Total</span><span style={s.totalAmt}>{AED(total)}</span></div>

        <div style={s.step}>3 · Payment</div>
        <div style={s.segment} role="radiogroup" aria-label="Status">
          {["Unpaid", "Paid", "Draft", ...(editing ? ["Cancelled"] : [])].map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={status === option}
              style={{ ...s.segBtn, ...(status === option ? s.segBtnActive : {}) }}
              onClick={() => {
                setStatus(option);
                if (option === "Paid" && !paidDate) setPaidDate(today());
              }}
            >
              {option}
            </button>
          ))}
        </div>
        <div style={s.hint}>
          {status === "Draft" && "Draft: saved for later, stock is not touched."}
          {status === "Unpaid" && "Unpaid: stock is reserved now, mark Paid later from Invoices."}
          {status === "Paid" && "Paid: stock is taken out and revenue is counted."}
          {status === "Cancelled" && "Cancelled: any spools on this invoice go back into stock."}
        </div>

        {status === "Paid" && (
          <div className="two-column-fields" style={s.fieldGrid}>
            <div>
              <label style={s.label}>Paid by</label>
              <div style={s.segmentSmall}>
                {["Cash", "Card", "Bank Transfer"].map((method) => (
                  <button key={method} type="button" style={{ ...s.segBtn, ...(paymentMethod === method ? s.segBtnActive : {}) }} onClick={() => setPaymentMethod(method)}>
                    {method === "Bank Transfer" ? "Transfer" : method}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={s.label}>Reference (optional)</label>
              <input style={s.input} value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Transfer / card ref" />
            </div>
          </div>
        )}

        <details style={s.details}>
          <summary style={s.summary}>Invoice number &amp; dates</summary>
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
            {status === "Paid" && (
              <div>
                <label style={s.label}>Paid date</label>
                <input type="date" style={s.input} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </div>
            )}
          </div>
        </details>

        {(!customer.name || lines.length === 0) && (
          <div style={s.hint}>{!customer.name ? "Add a customer name" : "Add at least one item"} to create the invoice.</div>
        )}
        <div className="invoice-actions" style={s.actionRow}>
          {editing && <button type="button" style={s.secondaryBtn} disabled={generating} onClick={onCancel}>Cancel</button>}
          <button type="button" style={s.primaryBtn} disabled={lines.length === 0 || !customer.name || !invoiceNumberIsValid || !invoiceDate || generating} onClick={generate}>
            {generating ? "Saving…" : editing ? `Update invoice · ${AED(total)}` : `Create invoice · ${AED(total)}`}
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
  pickCard: { position: "relative", textAlign: "left", background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" },
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
  priceInput: { width: 72, border: "none", borderBottom: "1px dashed #DCD5C6", fontSize: 12, color: "#1B2A3D", padding: "3px 0" },
  qtyInput: { width: 40, height: 36, padding: 0, textAlign: "center", border: "none", fontSize: 14, fontWeight: 700 },
  lineTotal: { width: 84, textAlign: "right", fontSize: 13, fontWeight: 700, color: "#1B2A3D" },
  removeBtn: { background: "none", border: "none", color: "#B3451D", fontSize: 18, cursor: "pointer", lineHeight: 1 },
  summaryRow: { display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13, color: "#6B6355" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 14, borderTop: "2px solid #1B2A3D", fontWeight: 700, fontSize: 14, color: "#1B2A3D" },
  totalAmt: { fontSize: 20, fontWeight: 800, color: "#E8792D" },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  actionRow: { display: "flex", gap: 8, marginTop: 16 },
  primaryBtn: { flex: 1, minHeight: 50, background: "#E8792D", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  secondaryBtn: { background: "#fff", color: "#1B2A3D", border: "1.5px solid #DCD5C6", borderRadius: 8, padding: "12px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  error: { marginTop: 4, color: "#B3451D", fontSize: 11.5 },
  filamentSection: { marginBottom: 22, padding: 14, border: "1.5px solid #D8E5DF", borderRadius: 10, background: "#F4FAF7" },
  filamentSectionTitle: { color: "#16324F", fontSize: 14, fontWeight: 800 },
  filamentSectionHelp: { margin: "4px 0 12px", color: "#6B6355", fontSize: 11.5, lineHeight: 1.4 },
  filamentCard: { position: "relative", textAlign: "left", background: "#fff", border: "1.5px solid #CFE0D8", borderRadius: 9, padding: 11, display: "flex", flexDirection: "column", gap: 5, cursor: "pointer" },
  filamentMaterial: { color: "#047857", fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  filamentStock: { color: "#6B6355", fontSize: 11.5 },
  search: { minHeight: 44, fontSize: 15, marginBottom: 10 },
  chips: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12 },
  chip: { flex: "0 0 auto", minHeight: 38, padding: "0 14px", borderRadius: 999, border: "1.5px solid #DCD5C6", background: "#fff", color: "#1B2A3D", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  chipActive: { background: "#1B2A3D", borderColor: "#1B2A3D", color: "#fff" },
  group: { marginBottom: 18 },
  groupTitle: { color: "#16324F", fontSize: 14, fontWeight: 800, marginBottom: 8 },
  spoolGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px,1fr))", gap: 8, marginTop: 6 },
  pickCardOn: { borderColor: "#E8792D", boxShadow: "0 0 0 1px #E8792D inset" },
  disabledCard: { opacity: 0.45, cursor: "not-allowed" },
  qtyBadge: { position: "absolute", top: 6, right: 6, minWidth: 26, padding: "2px 7px", borderRadius: 999, background: "#E8792D", color: "#fff", fontSize: 11.5, fontWeight: 800, textAlign: "center" },
  customBtn: { width: "100%", minHeight: 46, marginTop: 4, border: "1.5px dashed #DCD5C6", borderRadius: 10, background: "transparent", color: "#1B2A3D", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  panelHead: { display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, color: "#E8792D" },
  step: { marginTop: 18, marginBottom: 8, color: "#1B2A3D", fontSize: 13, fontWeight: 800 },
  emptySmall: { padding: "14px", textAlign: "center", color: "#8A7F6D", fontSize: 13, border: "1.5px dashed #DCD5C6", borderRadius: 10 },
  priceLabel: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#8A7F6D", marginTop: 2 },
  stepper: { display: "flex", alignItems: "center", border: "1.5px solid #DCD5C6", borderRadius: 8, overflow: "hidden" },
  stepBtn: { width: 34, height: 36, border: "none", background: "#F6F3EC", color: "#1B2A3D", fontSize: 17, fontWeight: 800, cursor: "pointer" },
  segment: { display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: 6 },
  segmentSmall: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 },
  segBtn: { minHeight: 42, padding: "0 6px", borderRadius: 8, border: "1.5px solid #DCD5C6", background: "#fff", color: "#1B2A3D", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  segBtnActive: { background: "#1B2A3D", borderColor: "#1B2A3D", color: "#fff" },
  hint: { marginTop: 8, color: "#6B6355", fontSize: 12, lineHeight: 1.45 },
  details: { marginTop: 16, borderTop: "1.5px dashed #E4DFD3", paddingTop: 10 },
  summary: { minHeight: 36, display: "flex", alignItems: "center", cursor: "pointer", color: "#1B2A3D", fontSize: 13, fontWeight: 700 },
};
