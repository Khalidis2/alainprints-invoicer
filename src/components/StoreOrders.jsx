import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";
import { resendOrderEmail } from "../lib/storage";
import { FeeLine, FeeSummary } from "./StripeFees";

export default function StoreOrders({ orders, onStatus, onTestSpool, showToast }) {
  // Paid card orders are confirmed automatically, so "pending" alone would hide them. Start on All, newest first.
  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const visible = useMemo(
    () => orders.filter((order) => filter === "all" || order.status === filter).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [filter, orders],
  );
  const count = (status) => (status === "all" ? orders.length : orders.filter((order) => order.status === status).length);
  const pending = orders.filter((order) => order.status === "pending").length;

  const changeStatus = async (order, status) => {
    if (!window.confirm(`${status === "confirmed" ? "Confirm" : "Cancel"} ${order.reference}?`)) return;
    setBusyId(order.id);
    try {
      await onStatus(order.id, status);
      showToast(status === "confirmed" ? "Order confirmed and stock deducted" : "Order cancelled and stock restored");
    } catch (error) {
      showToast(/only pending/i.test(error.message || "") ? "That reservation had already expired, so its spools are back in stock." : error.message || "Couldn't update order");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <div style={s.heading}>
        <div><h2 style={s.title}>Store orders</h2><p style={s.sub}>{pending} pending reservation{pending === 1 ? "" : "s"}</p></div>
        <div style={s.filters}>
          {["all", "pending", "confirmed", "cancelled", "expired"].map((status) => (
            <button key={status} style={{ ...s.filter, ...(filter === status ? s.filterActive : {}) }} onClick={() => setFilter(status)}>{status} ({count(status)})</button>
          ))}
        </div>
      </div>

      <FeeSummary label="Paid by card (Stripe)" payments={orders.filter((order) => order.payment_status === "paid" && order.stripe_payment_intent).map((order) => ({ paymentIntent: order.stripe_payment_intent }))} />

      {onTestSpool && (
        <div style={s.testBox}>
          <span><strong>Payment test:</strong> adds an AED 2 "Card payment test" item to the store (no delivery fee, nothing ships). Order it by card, then remove it.</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button style={s.filter} onClick={() => onTestSpool(true).then(() => showToast("AED 2 test spool added to the store")).catch((e) => showToast(e.message))}>Add test spool</button>
            <button style={s.filter} onClick={() => onTestSpool(false).then(() => showToast("Test spool removed from the store")).catch((e) => showToast(e.message))}>Remove test spool</button>
          </span>
        </div>
      )}

      <div style={s.grid}>
        {visible.map((order) => (
          <article key={order.id} style={s.card}>
            <div style={s.cardHead}>
              <div><strong style={s.reference}>{order.reference}</strong><span style={s.date}>{new Date(order.created_at).toLocaleString("en-AE")}</span></div>
              <span style={{ ...s.status, ...(s[order.status] || {}) }}>{order.status}</span>
            </div>
            <div style={s.customer}><strong>{order.customer_name}</strong><span>{order.mobile}</span><span>{order.emirate}</span><span>{order.address}</span></div>
            <ul style={s.items}>
              {(order.store_order_items || []).map((item) => (
                <li key={item.id} style={s.item}><span>{item.material} · {item.color}</span><strong>{item.quantity} × {AED(Number(item.unit_price))}</strong></li>
              ))}
            </ul>
            <div style={s.total}><span>Total</span><strong>{AED(Number(order.total))}</strong></div>
            <div style={{ ...s.payment, ...(PAYMENT_STYLE[paymentKey(order)] || {}) }}>
              {paymentLabel(order)}
              {order.paid_at ? <small style={{ fontWeight: 600, opacity: 0.8 }}> · {new Date(order.paid_at).toLocaleString("en-AE", { dateStyle: "medium", timeStyle: "short" })}</small> : null}
            </div>
            {order.payment_status === "paid" && order.stripe_payment_intent ? <FeeLine paymentIntent={order.stripe_payment_intent} total={Number(order.total)} /> : null}
            {mapsLinkOf(order.notes) && (
              <a href={mapsLinkOf(order.notes)} target="_blank" rel="noreferrer" style={s.pin}>📍 Open delivery pin in Google Maps</a>
            )}
            {order.notes && <p style={s.notes}>{order.notes.replace(MAPS_URL, "").replace(/\s*\|\s*(?:Location pin:)?\s*$/, "").replace(/\s*Location pin:\s*/, " ")}</p>}
            <button style={s.resend} disabled={busyId === order.id} onClick={async () => {
              setBusyId(order.id);
              try { showToast(await resendOrderEmail(order.id)); } catch (error) { showToast(error.message || "Couldn't send"); } finally { setBusyId(null); }
            }}>Resend email</button>
            {order.status === "pending" && (
              <>
                {order.payment_method === "card" && order.payment_status !== "paid" ? <p style={s.expiry}>Customer is on the card payment page. If unpaid, the spools go back to stock automatically.</p> : null}
                <p style={s.expiry}>Reserved until {new Date(order.expires_at).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" })}</p>
                <div style={s.actions}>
                  <button style={s.cancel} disabled={busyId === order.id} onClick={() => changeStatus(order, "cancelled")}>Cancel & restore</button>
                  <button style={s.confirm} disabled={busyId === order.id} onClick={() => changeStatus(order, "confirmed")}>Confirm order</button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {visible.length === 0 && <div style={s.empty}>No {filter === "all" ? "" : filter} store orders.</div>}
    </section>
  );
}


const MAPS_URL = /https:\/\/www\.google\.com\/maps\?q=-?\d+\.\d+,-?\d+\.\d+/;
const mapsLinkOf = (notes) => (String(notes || "").match(MAPS_URL) || [""])[0];

const paymentKey = (order) => (order.payment_status === "paid" ? "paid" : order.payment_status === "refunded" ? "refunded" : order.payment_method === "card" ? "awaiting" : "later");
const paymentLabel = (order) => ({
  paid: "Paid by card (Stripe)",
  refunded: "Refunded in Stripe",
  awaiting: "Card payment not completed",
  later: "Pay later · WhatsApp order",
})[paymentKey(order)];
const PAYMENT_STYLE = {
  paid: { background: "#ECFDF5", color: "#047857", borderColor: "#A7F3D0" },
  refunded: { background: "#F5F3FF", color: "#6D28D9", borderColor: "#DDD6FE" },
  awaiting: { background: "#FFF7ED", color: "#B45309", borderColor: "#FED7AA" },
  later: { background: "#F8FAFC", color: "#475569", borderColor: "#E2E8F0" },
};

const s = {
  pin: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44, margin: "10px 0 0", borderRadius: 9, background: "#047857", color: "#fff", fontWeight: 800, fontSize: 13.5, textDecoration: "none" },
  payment: { marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid", fontSize: 12.5, fontWeight: 800 },
  heading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "flex-end", marginBottom: 18 },
  title: { margin: 0, fontSize: 24 },
  sub: { margin: "5px 0 0", color: "#8A7F6D", fontSize: 12 },
  filters: { display: "flex", flexWrap: "wrap", gap: 6 },
  filter: { padding: "8px 11px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#6B6355", fontWeight: 700, textTransform: "capitalize", cursor: "pointer" },
  filterActive: { borderColor: "#E8792D", background: "#FFF5ED", color: "#B45309" },
  testBox: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 14, padding: "10px 12px", border: "1px dashed #DCD5C6", borderRadius: 10, background: "#FFFDF8", color: "#6B6355", fontSize: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 },
  card: { padding: 16, border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff" },
  cardHead: { display: "flex", justifyContent: "space-between", gap: 12 },
  reference: { display: "block", color: "#16324F" },
  date: { display: "block", marginTop: 4, color: "#8A7F6D", fontSize: 10.5 },
  status: { alignSelf: "start", padding: "4px 8px", borderRadius: 20, fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  pending: { background: "#FFF7ED", color: "#C2410C" },
  confirmed: { background: "#ECFDF5", color: "#047857" },
  cancelled: { background: "#FEF2F2", color: "#B91C1C" },
  expired: { background: "#F3F4F6", color: "#6B7280" },
  customer: { display: "grid", gap: 3, marginTop: 14, color: "#6B6355", fontSize: 12 },
  items: { margin: "14px 0 0", padding: 0, listStyle: "none", borderTop: "1px solid #EFEAE0" },
  item: { display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid #EFEAE0", fontSize: 12 },
  total: { display: "flex", justifyContent: "space-between", marginTop: 12, color: "#16324F", fontSize: 16 },
  notes: { color: "#8A7F6D", fontSize: 11.5 },
  expiry: { color: "#B45309", fontSize: 11.5 },
  resend: { marginTop: 10, padding: "7px 10px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#6B6355", fontWeight: 700, fontSize: 12, cursor: "pointer" },
  actions: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 },
  cancel: { padding: 9, border: "1px solid #DC2626", borderRadius: 8, background: "#fff", color: "#B91C1C", fontWeight: 800, cursor: "pointer" },
  confirm: { padding: 9, border: 0, borderRadius: 8, background: "#047857", color: "#fff", fontWeight: 800, cursor: "pointer" },
  empty: { padding: 30, textAlign: "center", color: "#8A7F6D" },
};
