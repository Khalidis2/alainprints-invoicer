// One line on every website order saying what happened to its stock.
export default function StockNote({ order }) {
  const items = order.store_order_items || [];
  if (!items.length) return null;
  const count = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const list = items.map((item) => `${item.material} ${item.color} ×${item.quantity}`).join(", ");
  const returned = order.status === "cancelled" || order.status === "expired";
  const spoolWord = count === 1 ? "spool" : "spools";
  const paidAfter = returned && order.payment_status === "paid";
  return (
    <div style={{ ...s.box, ...(returned ? s.returned : s.taken) }}>
      {returned
        ? `↩ Stock returned: ${count} ${spoolWord} back in stock (${list})`
        : `📦 Stock taken out now: ${count} ${spoolWord} (${list})`}
      {paidAfter && <div style={s.warn}>Paid after the order was {order.status}: check stock before shipping.</div>}
    </div>
  );
}

const s = {
  box: { marginTop: 8, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.45, fontWeight: 700 },
  taken: { background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" },
  returned: { background: "#F3F4F6", color: "#4B5563", border: "1px solid #E5E7EB" },
  warn: { marginTop: 4, color: "#B45309", fontWeight: 700 },
};
