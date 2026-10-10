import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";
import { FeeLine, useStripeFees } from "./StripeFees";
import StockNote from "./StockNote";
import DeliveryPin, { pinFromNotes } from "./DeliveryPin";

const waNumber = (phone) => String(phone || "").replace(/[^\d]/g, "").replace(/^0(?=5)/, "971");
const FILTERS = [
  ["all", "All"],
  ["attention", "Needs attention"],
  ["paid", "Paid"],
  ["orders", "Website orders"],
  ["invoices", "Invoices"],
];

// One list for everything that was sold: website orders and invoices, newest first.
// Nothing is copied between them (an order already took its stock, an invoice would take it again),
// so each row opens the full Orders or Invoices screen when you need to change something.
export function buildEntries(invoices, storeOrders) {
  const fromInvoices = invoices.map((invoice) => {
    const status = invoice.status || "Unpaid";
    return {
      key: `inv-${invoice.id}`,
      kind: "invoice",
      ref: `INV-${invoice.number}`,
      when: new Date(invoice.date || invoice.paidDate || 0).getTime() || 0,
      whenLabel: invoice.date || "",
      name: invoice.customer?.name || "No name",
      phone: invoice.customer?.phone || "",
      summary: (invoice.lines || []).map((line) => `${line.qty} × ${line.name}`).slice(0, 4),
      total: Number(invoice.total) || 0,
      status,
      paid: status === "Paid",
      done: ["Paid", "Refunded", "Cancelled"].includes(status),
      attention: status === "Unpaid" || status === "Draft",
      intent: status === "Paid" ? invoice.stripePaymentIntent : "",
      tab: "history",
    };
  });
  const fromOrders = storeOrders.map((order) => {
    const paid = order.payment_status === "paid";
    return {
      key: `ord-${order.id}`,
      kind: "order",
      ref: order.reference,
      when: new Date(order.created_at).getTime() || 0,
      whenLabel: new Date(order.created_at).toLocaleDateString("en-AE"),
      name: order.customer_name,
      phone: order.mobile,
      place: [order.emirate, order.address].filter(Boolean).join(" · "),
      summary: (order.store_order_items || []).map((item) => `${item.quantity} × ${item.material} ${item.color}`).slice(0, 4),
      total: Number(order.total) || 0,
      status: order.payment_status === "refunded" ? "refunded" : order.status,
      paid,
      done: ["cancelled", "expired"].includes(order.status) || order.payment_status === "refunded",
      attention: order.status === "pending",
      intent: paid ? order.stripe_payment_intent : "",
      order,
      pin: pinFromNotes(order.notes),
      address: order.address,
      emirate: order.emirate,
      mobile: order.mobile,
      notes: order.notes,
      quantity: (order.store_order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      items: (order.store_order_items || []).map((item) => `${item.quantity} x ${item.material} ${item.color}`),
      tab: "store-orders",
    };
  });
  return [...fromInvoices, ...fromOrders].sort((a, b) => b.when - a.when);
}

// Where the money went: everything customers paid, what Stripe kept, and what is really yours.
export function Breakdown({ entries, waiting, waitingTotal }) {
  const paid = entries.filter((entry) => entry.paid);
  const card = paid.filter((entry) => entry.intent);
  const other = paid.filter((entry) => !entry.intent);
  const ids = useMemo(() => card.map((entry) => entry.intent), [card]);
  const { fees, status } = useStripeFees(ids);

  const usable = (fee) => fee && !fee.pending && !fee.error && typeof fee.net === "number";
  const confirmed = card.filter((entry) => usable(fees[entry.intent]));
  const unconfirmed = card.filter((entry) => !usable(fees[entry.intent]));
  const cardPaid = confirmed.reduce((sum, entry) => sum + fees[entry.intent].gross, 0);
  const cardFees = confirmed.reduce((sum, entry) => sum + fees[entry.intent].fee, 0);
  const cardNet = confirmed.reduce((sum, entry) => sum + fees[entry.intent].net, 0);
  const otherPaid = other.reduce((sum, entry) => sum + entry.total, 0);
  const unconfirmedPaid = unconfirmed.reduce((sum, entry) => sum + entry.total, 0);
  const totalPaid = cardPaid + otherPaid + unconfirmedPaid;
  const youKeep = cardNet + otherPaid + unconfirmedPaid;

  return (
    <div style={s.break}>
      <div style={s.keep}>
        <small>You keep, after Stripe fees</small>
        <b style={{ fontSize: 28 }}>{AED(youKeep)}</b>
        <span>{status === "loading" ? "Checking Stripe…" : `${paid.length} paid · ${AED(totalPaid)} paid by customers − ${AED(cardFees)} Stripe fees`}</span>
      </div>
      <div style={s.parts}>
        <div style={s.part}>
          <strong>💳 Card (Stripe)</strong>
          <small>{confirmed.length} payment{confirmed.length === 1 ? "" : "s"}, fees taken by Stripe</small>
          <div style={s.line}><span>Customers paid</span><b>{AED(cardPaid)}</b></div>
          <div style={s.line}><span>Stripe fees</span><b style={{ color: "#B3451D" }}>− {AED(cardFees)}</b></div>
          <div style={{ ...s.line, ...s.lineNet }}><span>You receive</span><b>{AED(cardNet)}</b></div>
        </div>
        <div style={s.part}>
          <strong>💵 Cash, bank &amp; other</strong>
          <small>{other.length} payment{other.length === 1 ? "" : "s"}, no Stripe fee</small>
          <div style={s.line}><span>Customers paid</span><b>{AED(otherPaid)}</b></div>
          <div style={s.line}><span>Fees</span><b>AED 0.00</b></div>
          <div style={{ ...s.line, ...s.lineNet }}><span>You receive</span><b>{AED(otherPaid)}</b></div>
        </div>
        <div style={{ ...s.part, ...s.partWait }}>
          <strong>⏳ Waiting</strong>
          <small>{waiting.length} unpaid or pending</small>
          <div style={{ ...s.line, ...s.lineNet, color: "#B45309" }}><span>Not received yet</span><b>{AED(waitingTotal)}</b></div>
        </div>
      </div>
      {unconfirmed.length > 0 && status !== "loading" && (
        <small style={s.warnNote}>{unconfirmed.length} card payment{unconfirmed.length === 1 ? " is" : "s are"} not confirmed by Stripe yet, so {unconfirmed.length === 1 ? "it is" : "they are"} counted without a fee ({AED(unconfirmedPaid)}).</small>
      )}
    </div>
  );
}

export default function Sales({ invoices, storeOrders, onOpen }) {
  const [filter, setFilter] = useState("all");
  const entries = useMemo(() => buildEntries(invoices, storeOrders), [invoices, storeOrders]);
  const visible = entries.filter((entry) => {
    if (filter === "attention") return entry.attention;
    if (filter === "paid") return entry.paid;
    if (filter === "orders") return entry.kind === "order";
    if (filter === "invoices") return entry.kind === "invoice";
    return true;
  });
  const waiting = entries.filter((entry) => entry.attention);
  const waitingTotal = waiting.reduce((sum, entry) => sum + entry.total, 0);
  const count = (id) => entries.filter((entry) => (id === "attention" ? entry.attention : id === "paid" ? entry.paid : id === "orders" ? entry.kind === "order" : id === "invoices" ? entry.kind === "invoice" : true)).length;

  return (
    <section>
      <div style={s.heading}>
        <h2 style={s.title}>All sales</h2>
        <p style={s.sub}>Website orders and invoices together, newest first. Tap a row to open it.</p>
      </div>

      <Breakdown entries={entries} waiting={waiting} waitingTotal={waitingTotal} />

      <div style={s.filters} role="group" aria-label="Filter sales">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} style={{ ...s.chip, ...(filter === id ? s.chipOn : {}) }}>{label} ({count(id)})</button>
        ))}
      </div>

      <div style={s.list}>
        {visible.map((entry) => (
          <article key={entry.key} style={{ ...s.card, opacity: entry.done && !entry.paid ? 0.6 : 1 }}>
            <div style={s.top}>
              <div style={{ minWidth: 0 }}>
                <span style={{ ...s.kind, ...(entry.kind === "order" ? s.kindOrder : s.kindInvoice) }}>{entry.kind === "order" ? "Website order" : "Invoice"}</span>
                <strong style={s.ref}>{entry.ref}</strong>
                <span style={s.date}>{entry.whenLabel}</span>
              </div>
              <span style={{ ...s.pill, ...(entry.paid ? s.pillPaid : entry.attention ? s.pillWait : s.pillOther) }}>{entry.paid ? "Paid" : entry.status}</span>
            </div>
            <div style={s.who}><strong>{entry.name}</strong>{entry.phone ? <span>{entry.phone}</span> : null}</div>
            {entry.place ? <div style={s.place}>{entry.place}</div> : null}
            <ul style={s.items}>
              {entry.summary.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
            <div style={s.totalRow}><span>Total</span><strong>{AED(entry.total)}</strong></div>
            {entry.kind === "order" && entry.order ? <StockNote order={entry.order} /> : null}
            {entry.intent ? <FeeLine paymentIntent={entry.intent} total={entry.total} /> : null}
            {entry.kind === "order" ? <DeliveryPin pin={entry.pin} address={entry.address} emirate={entry.emirate} name={entry.name} ship={{ reference: entry.ref, name: entry.name, mobile: entry.mobile, notes: entry.notes, emirate: entry.emirate, address: entry.address, pin: entry.pin, items: entry.items, quantity: entry.quantity, total: entry.total, paid: entry.paid }} /> : null}
            <div style={s.actions}>
              <button type="button" style={s.open} onClick={() => onOpen(entry.tab)}>{entry.kind === "order" ? "Open in Orders" : "Open in Invoices"} →</button>
              {entry.phone ? <a style={s.link} href={`https://wa.me/${waNumber(entry.phone)}`} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            </div>
          </article>
        ))}
      </div>
      {visible.length === 0 && <div style={s.empty}>Nothing here yet.</div>}
    </section>
  );
}

const s = {
  break: { display: "grid", gap: 10, margin: "0 0 16px", padding: 14, border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff" },
  keep: { display: "grid", gap: 3, padding: "12px 14px", border: "1px solid #A7D7C5", borderRadius: 10, background: "#F0FDF7", color: "#047857" },
  parts: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 },
  part: { display: "grid", gap: 5, padding: "12px 14px", border: "1px solid #EFEAE0", borderRadius: 10, background: "#FBFAF6", color: "#3F3A30", fontSize: 13 },
  partWait: { background: "#FFF7ED", borderColor: "#FED7AA" },
  line: { display: "flex", justifyContent: "space-between", gap: 10, color: "#6B6355" },
  lineNet: { paddingTop: 5, borderTop: "1px dashed #DCD5C6", color: "#047857", fontWeight: 800 },
  warnNote: { color: "#B45309", lineHeight: 1.45 },
  heading: { marginBottom: 14 },
  title: { margin: 0, fontSize: 24 },
  sub: { margin: "5px 0 0", color: "#8A7F6D", fontSize: 13 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, margin: "0 0 14px" },
  stat: { display: "grid", gap: 3, padding: "12px 14px", border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff", color: "#6B6355", fontSize: 12 },
  filters: { display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 14px" },
  chip: { minHeight: 40, padding: "0 12px", border: "1px solid #DCD5C6", borderRadius: 999, background: "#fff", color: "#6B6355", fontWeight: 700, cursor: "pointer" },
  chipOn: { borderColor: "#E8792D", background: "#FFF5ED", color: "#B45309" },
  list: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 },
  card: { display: "grid", gap: 8, padding: 16, border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff", alignContent: "start" },
  top: { display: "flex", justifyContent: "space-between", gap: 10 },
  kind: { display: "inline-block", marginBottom: 4, padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em" },
  kindOrder: { background: "#ECFDF5", color: "#047857" },
  kindInvoice: { background: "#EFF6FF", color: "#1D4ED8" },
  ref: { display: "block", color: "#16324F" },
  date: { display: "block", marginTop: 2, color: "#8A7F6D", fontSize: 11 },
  pill: { alignSelf: "start", padding: "4px 9px", borderRadius: 999, fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  pillPaid: { background: "#ECFDF5", color: "#047857" },
  pillWait: { background: "#FFF7ED", color: "#C2410C" },
  pillOther: { background: "#F3F4F6", color: "#6B7280" },
  who: { display: "grid", gap: 2, fontSize: 13.5 },
  place: { color: "#6B6355", fontSize: 12.5, lineHeight: 1.4 },
  items: { margin: 0, padding: "8px 0 0 18px", borderTop: "1px solid #EFEAE0", color: "#3F3A30", fontSize: 13, lineHeight: 1.5 },
  totalRow: { display: "flex", justifyContent: "space-between", fontSize: 14 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  open: { minHeight: 42, padding: "0 14px", border: 0, borderRadius: 8, background: "#16324F", color: "#fff", fontWeight: 800, cursor: "pointer" },
  link: { display: "inline-flex", alignItems: "center", minHeight: 42, padding: "0 12px", border: "1px solid #16324F", borderRadius: 8, color: "#16324F", fontWeight: 800, textDecoration: "none" },
  empty: { padding: 30, textAlign: "center", color: "#8A7F6D" },
};
