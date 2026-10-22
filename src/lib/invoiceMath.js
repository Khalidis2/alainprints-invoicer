// Money helpers shared by the dashboard, invoice builder and invoice detail.
// Deposits are stored in the invoice meta line as `payments`. The stored status stays Unpaid until
// the full amount is received, so stock reservation and Stripe logic work exactly as before.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const monthKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const previousMonthKey = (date = new Date()) => monthKey(new Date(date.getFullYear(), date.getMonth() - 1, 1));

export const paymentsOf = (invoice) => (Array.isArray(invoice?.payments) ? invoice.payments.filter((p) => Number(p?.amount) > 0) : []);

export const receivedSoFar = (invoice) => {
  const status = invoice?.status || "Unpaid";
  const total = round2(invoice?.total);
  if (status === "Paid") return total;
  if (status !== "Unpaid") return 0;
  return Math.min(total, round2(paymentsOf(invoice).reduce((sum, p) => sum + Number(p.amount), 0)));
};

export const remainingOf = (invoice) => {
  const status = invoice?.status || "Unpaid";
  if (status !== "Unpaid") return 0;
  return round2(Math.max(0, Number(invoice.total || 0) - receivedSoFar(invoice)));
};

export const isPartPaid = (invoice) => (invoice?.status || "Unpaid") === "Unpaid" && receivedSoFar(invoice) > 0;

export const displayStatus = (invoice) => (isPartPaid(invoice) ? "Part paid" : invoice?.status || "Unpaid");

export const daysSince = (isoDate, now = new Date()) => {
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400000));
};

export const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Money that actually came in, as {date, amount}. A deposit counts on the day it was received.
export const receiptsOf = (invoice) => {
  const status = invoice?.status || "Unpaid";
  const payments = paymentsOf(invoice).map((p) => ({ date: p.date || invoice.date, amount: Number(p.amount) }));
  if (status === "Unpaid") return payments;
  if (status !== "Paid") return [];
  const sum = payments.reduce((total, p) => total + p.amount, 0);
  const rest = round2(Number(invoice.total || 0) - sum);
  return rest > 0 ? [...payments, { date: invoice.paidDate || invoice.date, amount: rest }] : payments;
};

export const lineCategory = (line, itemsById) => {
  if (String(line?.itemId || "").startsWith("filament-spool:")) return "Filament";
  return itemsById.get(line?.itemId)?.category || "Custom";
};

// Spread a received amount over the invoice lines, so discounts and deposits are shared fairly.
export const splitByCategory = (invoice, amount, itemsById) => {
  const lines = invoice.lines || [];
  const subtotal = lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty || 0), 0);
  const out = {};
  if (!(subtotal > 0)) {
    out.Custom = amount;
    return out;
  }
  for (const line of lines) {
    const share = (Number(line.price || 0) * Number(line.qty || 0)) / subtotal;
    const category = lineCategory(line, itemsById);
    out[category] = (out[category] || 0) + amount * share;
  }
  return out;
};

export const TYPE_ORDER = ["3D Print", "Filament", "Sublimation", "Custom"];
export const TYPE_LABEL = { "3D Print": "3D products", Filament: "Filament spools", Sublimation: "Sublimation", Custom: "Custom work" };
export const TYPE_COLOR = { "3D Print": "#16324F", Filament: "#046461", Sublimation: "#E8792D", Custom: "#8A6FB0" };

// Everything received in one month, split by item type, plus the best sellers.
export function monthReport({ invoices, storeOrders, items, month }) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const byType = {};
  const sellers = new Map();
  let payments = 0;

  for (const invoice of invoices) {
    for (const receipt of receiptsOf(invoice)) {
      if (monthKey(receipt.date) !== month) continue;
      payments += 1;
      const split = splitByCategory(invoice, receipt.amount, itemsById);
      for (const [category, amount] of Object.entries(split)) byType[category] = (byType[category] || 0) + amount;
      const subtotal = (invoice.lines || []).reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty || 0), 0);
      if (subtotal > 0) {
        for (const line of invoice.lines || []) {
          const share = (receipt.amount * Number(line.price || 0) * Number(line.qty || 0)) / subtotal;
          sellers.set(line.name, (sellers.get(line.name) || 0) + share);
        }
      }
    }
  }
  // Website orders sell filament spools, and are already paid when marked paid.
  for (const order of storeOrders) {
    if (order.payment_status !== "paid" || monthKey(order.created_at) !== month) continue;
    payments += 1;
    byType.Filament = (byType.Filament || 0) + Number(order.total || 0);
    for (const item of order.store_order_items || []) {
      const label = `${item.material} ${item.color}`.trim();
      sellers.set(label, (sellers.get(label) || 0) + Number(item.unit_price || 0) * Number(item.quantity || 0));
    }
  }

  const total = Object.values(byType).reduce((sum, v) => sum + v, 0);
  const rows = TYPE_ORDER.map((type) => ({ type, label: TYPE_LABEL[type], color: TYPE_COLOR[type], amount: round2(byType[type] || 0) }))
    .filter((row) => row.amount > 0);
  for (const row of rows) row.percent = total > 0 ? (row.amount / total) * 100 : 0;
  const top = [...sellers.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 3);
  return { total: round2(total), rows, top, payments };
}

// WhatsApp wants the number with the country code and no symbols (UAE mobiles start 05…).
export const waNumber = (phone) => String(phone || "").replace(/[^\d]/g, "").replace(/^00/, "").replace(/^0(?=5)/, "971");

export const hasWhatsAppNumber = (phone) => waNumber(phone).length >= 9;

export function reminderText(invoice, AED) {
  const left = remainingOf(invoice);
  const name = String(invoice.customer?.name || "").trim().split(/\s+/)[0];
  const amount = left > 0 ? AED(left) : AED(invoice.total);
  const parts = [
    `Hi${name ? ` ${name}` : ""}, a friendly reminder from Alain Prints: INV-${invoice.number} has ${amount} left to pay${invoice.dueDate ? `, due ${invoice.dueDate}` : ""}.`,
  ];
  if (invoice.stripeLinkUrl) parts.push(`You can pay by card here: ${invoice.stripeLinkUrl}`);
  parts.push("Thank you!");
  return parts.join(" ");
}
