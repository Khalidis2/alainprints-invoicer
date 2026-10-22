import { useEffect, useState } from "react";
import { AED, today, CAT_STYLE } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";
import { autoLinkLines } from "../lib/stockCheck";

const StepBadge = ({ n }) => (
  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 999, background: "#0F6B64", color: "#fff", fontSize: 12.5, fontWeight: 850 }}>{n}</span>
);

export default function InvoiceBuilder({ items, customers = [], filaments = [], invoiceNo, initialInvoice, onSave, onFinished, onCancel, showToast }) {
  const editing = Boolean(initialInvoice);
  const [customer, setCustomer] = useState(initialInvoice?.customer ?? { name: "", phone: "", email: "" });
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
  // The discount is typed either as an amount (AED) or as a percentage of the subtotal. Only the AED amount is saved.
  const [discountMode, setDiscountMode] = useState("amount");
  const [finalized, setFinalized] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("all");

  const addItem = (item) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      const base = { itemId: item.id, name: item.name, price: item.price, qty: 1, filamentId: item.filamentId || null, gramsPerUnit: Number(item.gramsPerUnit || 0) };
      return [...prev, autoLinkLines([base], filaments).lines[0]];
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
  const linkLine = (itemId, filamentId) => {
    const f = availableFilaments.find((x) => x.id === filamentId);
    if (!f) return;
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, filamentId: f.id, gramsPerUnit: Number(f.spoolWeightG || 1000) } : l)));
  };
  useEffect(() => {
    if (editing) return;
    const { lines: linkedLines, linked } = autoLinkLines(lines, filaments);
    if (linked) setLines(linkedLines);
  }, [filaments]); // eslint-disable-line react-hooks/exhaustive-deps
  const removeLine = (itemId) => setLines((prev) => prev.filter((l) => l.itemId !== itemId));

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const typedDiscount = Math.max(0, Number(discountInput) || 0);
  const discount = discountMode === "percent"
    ? Math.round(subtotal * Math.min(typedDiscount, 100)) / 100
    : Math.min(typedDiscount, subtotal);
  const total = subtotal - discount;
  const parsedInvoiceNo = Number(customInvoiceNo);
  const invoiceNumberIsValid = Number.isInteger(parsedInvoiceNo) && parsedInvoiceNo > 0;

  const generate = async () => {
    if (lines.length === 0 || !invoiceNumberIsValid) return;
    setGenerating(true);
    try {
      const saved = await onSave({
        id: initialInvoice?.id,
        stripeLinkId: initialInvoice?.stripeLinkId,
        stripeLinkUrl: initialInvoice?.stripeLinkUrl,
        stripeLinkAmount: initialInvoice?.stripeLinkAmount,
        stripePaymentIntent: initialInvoice?.stripePaymentIntent,
        stripeRefundedAmount: initialInvoice?.stripeRefundedAmount,
        refundedDate: initialInvoice?.refundedDate,
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
      showToast(`${editing ? "Invoice updated" : "Invoice saved"}${movesStock ? " · checking stock…" : ""}`);
    } catch (e) {
      showToast(e.code === "23505" ? `Invoice #${parsedInvoiceNo} already exists` : (e.message || "Couldn't save invoice — check connection"));
    } finally {
      setGenerating(false);
    }
  };

  // Keep the suggested number current (it loads after the screen opens and moves up after each save),
  // without remounting the screen, so the saved invoice + payment link view stays visible.
  useEffect(() => {
    if (!editing && !finalized && lines.length === 0) setCustomInvoiceNo(String(invoiceNo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNo]);

  const startOver = () => {
    setFinalized(null);
    setCustomer({ name: "", phone: "", email: "" });
    setLines([]);
    setNotes("");
    setDiscountInput("");
    setDiscountMode("amount");
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
        showPaymentLink
        showToast={showToast}
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
    setCustomer(saved ? { name: saved.name, phone: saved.phone || customer.phone, email: customer.email || "" } : { ...customer, name });
  };

  const STATUS_COLOR = { Unpaid: "#B45309", Paid: "#0F6B64", Draft: "#5B6573", Cancelled: "#B3451D" };

  const sections = [
    { id: "all", label: "All" },
    ...productCategories.map((category) => ({ id: category, label: category })),
    { id: "spools", label: `Spools (${availableFilaments.length})` },
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
                  <button key={item.id} type="button" style={{ ...s.pickCard, borderLeftColor: cs.fg, ...(inInvoice ? s.pickCardOn : {}) }} onClick={() => addItem(item)}>
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

        <div style={s.step}><StepBadge n={1} />Customer</div>
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
        <input
          type="email"
          style={{ ...s.input, marginTop: 8 }}
          value={customer.email || ""}
          onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
          placeholder="Customer email (optional, to send the PDF)"
          aria-label="Customer email"
        />

        <div style={s.step}><StepBadge n={2} />Items</div>
        {lines.length === 0 ? (
          <div style={s.emptySmall}>Nothing added yet. Tap a product or spool.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lines.map((l) => (
              <div key={l.itemId} className="invoice-line-editor" style={s.lineRow}>
                <input aria-label="Item name" style={{ ...s.lineNameInput, gridArea: "name" }} value={l.name} onChange={(e) => setLine(l.itemId, "name", e.target.value)} />
                <label style={{ ...s.priceLabel, gridArea: "price" }}>
                  Price (AED)
                  <input aria-label="Unit price" type="number" inputMode="decimal" min="0" step="0.01" style={s.priceInput} value={l.price} onChange={(e) => setLine(l.itemId, "price", e.target.value)} />
                </label>
                <div style={{ gridArea: "stock" }}>
                  {l.filamentId ? (
                    <div style={{ fontSize: 12.5, color: "#15803d", fontWeight: 700 }}>📦 Takes {l.qty} spool(s) from stock</div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "#b45309", background: "#FEF3E2", borderRadius: 10, padding: "8px 10px" }}>
                      ⚠ Not linked to stock — will NOT deduct.
                      <select aria-label="Take from stock" value="" onChange={(e) => linkLine(l.itemId, e.target.value)} style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, padding: "8px 10px", borderRadius: 10, border: "1.5px solid #DCD5C6", background: "#fff", color: "#1B2A3D" }}>
                        <option value="">Link to a spool…</option>
                        {availableFilaments.map((f) => <option key={f.id} value={f.id}>{f.material} {f.color} ({f.availableSpools} left)</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div style={{ ...s.stepper, gridArea: "stepper" }}>
                  <button type="button" style={s.stepBtn} aria-label="One less" onClick={() => changeQty(l.itemId, -1)}>−</button>
                  <input type="number" inputMode="numeric" min="1" aria-label="Quantity" value={l.qty} onChange={(e) => setQty(l.itemId, e.target.value)} style={s.qtyInput} />
                  <button type="button" style={s.stepBtn} aria-label="One more" onClick={() => increaseLine(l.itemId)}>+</button>
                </div>
                <div style={{ ...s.lineTotal, gridArea: "total" }}>{AED(l.price * l.qty)}</div>
                <button type="button" style={{ ...s.removeBtn, gridArea: "remove" }} aria-label="Remove" onClick={() => removeLine(l.itemId)}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="two-column-fields" style={{ ...s.fieldGrid, marginTop: 6 }}>
          <div>
            <label style={s.label}>
              Discount
              <span style={{ display: "inline-flex", marginLeft: 8, border: "1px solid #DCD5C6", borderRadius: 7, overflow: "hidden", verticalAlign: "middle" }}>
                {[["amount", "AED"], ["percent", "%"]].map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => { setDiscountMode(mode); setDiscountInput(""); }} style={{ padding: "3px 10px", border: 0, cursor: "pointer", fontSize: 12, fontWeight: 800, background: discountMode === mode ? "#0F6B64" : "#fff", color: discountMode === mode ? "#fff" : "#746A59" }}>{label}</button>
                ))}
              </span>
            </label>
            <input type="number" inputMode="decimal" min="0" max={discountMode === "percent" ? 100 : subtotal} step={discountMode === "percent" ? "0.5" : "0.01"} style={s.input} value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} placeholder={discountMode === "percent" ? "e.g. 10" : "0"} />
            {discountMode === "percent" && discount > 0 && <div style={{ marginTop: 4, fontSize: 12, color: "#746A59" }}>= {AED(discount)} off</div>}
          </div>
          <div>
            <label style={s.label}>Note (optional)</label>
            <input style={s.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pickup Thursday…" />
          </div>
        </div>

        <div style={s.summaryRow}><span>Subtotal</span><span>{AED(subtotal)}</span></div>
        {discount > 0 && <div style={s.summaryRow}><span>Discount{discountMode === "percent" ? ` (${typedDiscount}%)` : ""}</span><span>− {AED(discount)}</span></div>}
        <div style={s.totalRow}><span>Total</span><span style={s.totalAmt}>{AED(total)}</span></div>

        <div style={s.step}><StepBadge n={3} />Payment</div>
        <div style={s.segment} role="radiogroup" aria-label="Status">
          {["Unpaid", "Paid", "Draft", ...(editing ? ["Cancelled"] : [])].map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={status === option}
              style={{ ...s.segBtn, ...(status === option ? { ...s.segBtnActive, background: STATUS_COLOR[option], borderColor: STATUS_COLOR[option] } : {}) }}
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
  h2: { fontSize: 26, fontWeight: 850, margin: 0, color: "#16324F", letterSpacing: "-0.01em" },
  sub: { fontSize: 13.5, color: "#746A59", marginTop: 4, marginBottom: 18 },
  pickGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10 },
  pickCard: { position: "relative", textAlign: "left", background: "#fff", border: "1.5px solid #E4DFD3", borderLeftWidth: 5, borderRadius: 14, padding: "12px 12px 12px 14px", display: "flex", flexDirection: "column", gap: 6, cursor: "pointer", minHeight: 104, boxShadow: "0 1px 2px rgba(22,50,79,.05)" },
  pickThumb: { width: "100%", height: 90, objectFit: "cover", borderRadius: 6, background: "#F1EDE3" },
  pickName: { fontWeight: 750, fontSize: 14, lineHeight: 1.25, color: "#16324F" },
  pickPrice: { marginTop: "auto", fontSize: 14, fontWeight: 800, color: "#0F6B64" },
  badge: { fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 700 },
  panel: { background: "#fff", border: "1px solid #E4DFD3", borderRadius: 20, padding: 18, position: "sticky", top: 16, overflow: "hidden", boxShadow: "0 12px 32px rgba(22,50,79,.10)" },
  panelTitle: { fontSize: 13, fontWeight: 700, color: "#B9531A", marginBottom: 4 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#746A59", marginTop: 12, marginBottom: 5 },
  input: { width: "100%", boxSizing: "border-box", minHeight: 46, padding: "10px 13px", borderRadius: 12, border: "1.5px solid #DCD5C6", fontSize: 14.5, background: "#FDFCF9", color: "#1B2A3D" },
  hr: { borderTop: "1.5px dashed #E4DFD3", margin: "14px 0" },
  lineRow: { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gridTemplateAreas: '"name name remove" "price stepper total" "stock stock stock"', alignItems: "center", gap: "10px 10px", padding: 12, background: "#FBF9F4", border: "1px solid #EBE5D8", borderRadius: 14 },
  lineNameInput: { width: "100%", minHeight: 40, border: "none", borderBottom: "1.5px solid #E4DFD3", background: "transparent", borderRadius: 0, fontSize: 14.5, fontWeight: 800, color: "#16324F", padding: "4px 0" },
  priceInput: { width: 96, minHeight: 44, border: "1.5px solid #DCD5C6", borderRadius: 10, fontSize: 15, fontWeight: 700, color: "#1B2A3D", padding: "8px 10px", background: "#fff" },
  qtyInput: { width: 44, height: 44, padding: 0, textAlign: "center", border: "none", fontSize: 16, fontWeight: 800, background: "#fff" },
  lineTotal: { minWidth: 76, textAlign: "right", fontSize: 15, fontWeight: 850, color: "#16324F" },
  removeBtn: { width: 44, height: 44, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 12, border: "none", background: "#FBECE6", color: "#B3451D", cursor: "pointer" },
  summaryRow: { display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 14, color: "#6B6355" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "14px 16px", borderRadius: 14, background: "#FFF1E4", fontWeight: 800, fontSize: 15, color: "#16324F" },
  totalAmt: { fontSize: 28, fontWeight: 900, color: "#B9531A", letterSpacing: "-0.01em" },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  actionRow: { display: "flex", gap: 8, marginTop: 16 },
  primaryBtn: { flex: 1, minHeight: 56, background: "linear-gradient(180deg,#E8792D,#B9531A)", color: "#fff", border: "none", borderRadius: 14, padding: "12px", fontWeight: 850, fontSize: 16, cursor: "pointer", boxShadow: "0 6px 16px rgba(185,83,26,.28)" },
  secondaryBtn: { minHeight: 56, background: "#fff", color: "#16324F", border: "1.5px solid #DCD5C6", borderRadius: 14, padding: "12px 18px", fontWeight: 750, fontSize: 14, cursor: "pointer" },
  empty: { padding: "30px 16px", textAlign: "center", color: "#746A59", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  error: { marginTop: 4, color: "#B3451D", fontSize: 11.5 },
  filamentSection: { marginBottom: 22, padding: 14, border: "1.5px solid #D8E5DF", borderRadius: 10, background: "#F4FAF7" },
  filamentSectionTitle: { color: "#16324F", fontSize: 14, fontWeight: 800 },
  filamentSectionHelp: { margin: "4px 0 12px", color: "#6B6355", fontSize: 11.5, lineHeight: 1.4 },
  filamentCard: { position: "relative", textAlign: "left", background: "#fff", border: "1.5px solid #CFE0D8", borderRadius: 9, padding: 11, display: "flex", flexDirection: "column", gap: 5, cursor: "pointer" },
  filamentMaterial: { color: "#047857", fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  filamentStock: { color: "#6B6355", fontSize: 11.5 },
  search: { minHeight: 50, fontSize: 15, marginBottom: 12, borderRadius: 14 },
  chips: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12 },
  chip: { flex: "0 0 auto", minHeight: 42, padding: "0 16px", borderRadius: 999, border: "1.5px solid #DCD5C6", background: "#fff", color: "#16324F", fontWeight: 750, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" },
  chipActive: { background: "#0F6B64", borderColor: "#0F6B64", color: "#fff" },
  group: { marginBottom: 18 },
  groupTitle: { color: "#16324F", fontSize: 14, fontWeight: 800, marginBottom: 8 },
  spoolGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px,1fr))", gap: 8, marginTop: 6 },
  pickCardOn: { borderColor: "#E8792D", background: "#FFF4EA", boxShadow: "0 0 0 1px #E8792D inset" },
  disabledCard: { opacity: 0.45, cursor: "not-allowed" },
  qtyBadge: { position: "absolute", top: 8, right: 8, minWidth: 28, padding: "3px 8px", borderRadius: 999, background: "#B9531A", color: "#fff", fontSize: 12, fontWeight: 850, textAlign: "center" },
  customBtn: { width: "100%", minHeight: 52, marginTop: 4, border: "1.5px dashed #B9B09B", borderRadius: 14, background: "transparent", color: "#16324F", fontWeight: 750, fontSize: 14, cursor: "pointer" },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "-18px -18px 4px", padding: "16px 18px", background: "#16324F", color: "#fff", fontSize: 17, fontWeight: 850 },
  step: { display: "flex", alignItems: "center", gap: 9, marginTop: 22, marginBottom: 10, color: "#16324F", fontSize: 14.5, fontWeight: 850 },
  emptySmall: { padding: "18px", textAlign: "center", color: "#746A59", fontSize: 13.5, border: "1.5px dashed #CFC7B5", borderRadius: 14, background: "#FBF9F4" },
  priceLabel: { display: "flex", flexDirection: "column", gap: 3, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#746A59" },
  stepper: { display: "flex", alignItems: "center", border: "1.5px solid #DCD5C6", borderRadius: 12, overflow: "hidden", background: "#fff" },
  stepBtn: { width: 44, height: 44, border: "none", background: "#F1EDE3", color: "#16324F", fontSize: 20, fontWeight: 800, cursor: "pointer" },
  segment: { display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: 6 },
  segmentSmall: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 },
  segBtn: { minHeight: 46, padding: "0 6px", borderRadius: 12, border: "1.5px solid #DCD5C6", background: "#fff", color: "#16324F", fontWeight: 750, fontSize: 13.5, cursor: "pointer" },
  segBtnActive: { background: "#16324F", borderColor: "#16324F", color: "#fff" },
  hint: { marginTop: 10, color: "#6B6355", fontSize: 12.5, lineHeight: 1.5 },
  details: { marginTop: 16, borderTop: "1.5px dashed #E4DFD3", paddingTop: 10 },
  summary: { minHeight: 36, display: "flex", alignItems: "center", cursor: "pointer", color: "#1B2A3D", fontSize: 13, fontWeight: 700 },
};
