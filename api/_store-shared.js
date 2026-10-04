// Shared helpers for website (printtools3d) orders: CORS, order lookup, delivery rule, email.
import { env, supabaseFetch } from "./_stripe-shared.js";

export const SITE_URL = "https://www.printtools3d.com";
const allowedOrigins = new Set(["https://www.printtools3d.com", "https://printtools3d.com"]);

export function cors(request, response, methods = "POST, OPTIONS") {
  const origin = request.headers.origin;
  if (allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", methods);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Same rule the website shows: free UAE delivery from AED 500, otherwise AED 20.
export function deliveryFor(subtotal) {
  return Number(subtotal) >= 500 ? 0 : 20;
}

export async function getStoreOrder(filter) {
  const rows = await supabaseFetch(`/rest/v1/store_orders?${filter}&select=*,store_order_items(*)&limit=1`);
  return rows?.[0] || null;
}

export async function updateStoreOrder(id, patch) {
  const rows = await supabaseFetch(`/rest/v1/store_orders?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { ...patch, updated_at: new Date().toISOString() },
  });
  return rows?.[0] || null;
}

// Make the order's delivery match the website rule (needs the service role key).
export async function applyDeliveryRule(order) {
  if (!env("SUPABASE_SERVICE_ROLE_KEY")) return order;
  const subtotal = Number(order.subtotal);
  const shipping = deliveryFor(subtotal);
  if (Number(order.shipping) === shipping) return order;
  const rows = await supabaseFetch(`/rest/v1/store_orders?id=eq.${encodeURIComponent(order.id)}`, {
    method: "PATCH",
    body: { shipping, total: subtotal + shipping, updated_at: new Date().toISOString() },
  }).catch(() => null);
  return Array.isArray(rows) && rows[0] ? { ...order, ...rows[0] } : { ...order, shipping, total: subtotal + shipping };
}

const aed = (value) => `AED ${Number(value || 0).toFixed(2)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Email to the shop owner via Resend. Never throws: an email problem must not break an order.
export async function emailOrder(order, headline, note = "") {
  const key = env("RESEND_API_KEY");
  if (!key) return { skipped: "RESEND_API_KEY not set" };
  const to = env("ORDER_EMAIL_TO") || "itsalainprints@gmail.com";
  const from = env("ORDER_EMAIL_FROM") || "printtools3d orders <onboarding@resend.dev>";
  const items = order.store_order_items || [];
  const rows = items.map((item) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(item.material)} · ${escapeHtml(item.color)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${escapeHtml(item.quantity)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${aed(item.unit_price * item.quantity)}</td></tr>`).join("");
  const paid = order.payment_status === "paid";
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
    <h2 style="margin:0 0 4px">${escapeHtml(headline)}</h2>
    <p style="margin:0 0 14px;color:#555">Order <b>${escapeHtml(order.reference)}</b> · ${paid ? "<b style=\"color:#047857\">PAID BY CARD</b>" : "<b style=\"color:#b45309\">NOT PAID YET (WhatsApp order)</b>"}</p>
    ${note ? `<p style="padding:10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px">${escapeHtml(note)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
      <tr><td style="padding:6px 8px">Delivery</td><td></td><td style="padding:6px 8px;text-align:right">${Number(order.shipping) === 0 ? "Free" : aed(order.shipping)}</td></tr>
      <tr><td style="padding:6px 8px"><b>Total</b></td><td></td><td style="padding:6px 8px;text-align:right"><b>${aed(order.total)}</b></td></tr>
    </table>
    <h3 style="margin:18px 0 6px">Customer</h3>
    <p style="margin:0;line-height:1.6">${escapeHtml(order.customer_name)}<br>${escapeHtml(order.mobile)}<br>${escapeHtml(order.emirate)} · ${escapeHtml(order.address)}${order.notes ? `<br>Notes: ${escapeHtml(order.notes)}` : ""}</p>
    <p style="margin:18px 0 0"><a href="https://wa.me/${escapeHtml(String(order.mobile).replace(/[^\d]/g, "").replace(/^0(?=5)/, "971"))}" style="color:#047857">WhatsApp the customer</a> · <a href="https://alainprints-invoicer.vercel.app/" style="color:#1d4ed8">Open invoicer → Orders</a></p>
  </div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `${headline} · ${order.reference} · ${aed(order.total)}`, html }),
    });
    return response.ok ? { sent: true } : { failed: response.status, detail: await response.text() };
  } catch (error) {
    return { failed: error.message };
  }
}

// Creates (reserves) a website order through the public database function, then applies the delivery rule.
export async function createStoreOrder(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 20) {
    const error = new Error("Select at least one product");
    error.status = 400;
    throw error;
  }
  const url = env("VITE_SUPABASE_URL") || env("SUPABASE_URL");
  const anonKey = env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw Object.assign(new Error("Order service is not configured"), { status: 500 });

  const result = await fetch(`${url}/rest/v1/rpc/create_store_order`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_customer_name: String(body.customer?.name || ""),
      p_mobile: String(body.customer?.mobile || ""),
      p_emirate: String(body.customer?.emirate || ""),
      p_address: String(body.customer?.address || ""),
      p_notes: String(body.customer?.notes || ""),
      p_items: items.map((item) => ({ material: String(item.material || ""), color: String(item.color || ""), quantity: Number(item.quantity || 0) })),
    }),
  });
  const data = await result.json();
  if (!result.ok) {
    const message = String(data?.message || data?.error || "Order could not be reserved");
    throw Object.assign(new Error(message), { status: message.includes("stock") ? 409 : 400 });
  }
  return applyDeliveryRule(Array.isArray(data) ? data[0] : data);
}

export async function markStoreOrderPaid(order, { paymentIntent, sessionId, amount } = {}) {
  if (order.payment_status === "paid") return { already: true, reference: order.reference };
  const wasPending = order.status === "pending";
  const updated = await updateStoreOrder(order.id, {
    payment_status: "paid",
    paid_at: new Date().toISOString(),
    stripe_payment_intent: paymentIntent || order.stripe_payment_intent || null,
    stripe_session_id: sessionId || order.stripe_session_id || null,
    ...(wasPending ? { status: "confirmed" } : {}),
  });
  const full = { ...order, ...(updated || {}), payment_status: "paid" };
  const note = !wasPending && order.status !== "confirmed"
    ? `Payment arrived after the order was ${order.status}. The reserved spools may have gone back to stock: check stock before shipping.`
    : Number(amount) && Math.round(Number(order.total) * 100) !== Number(amount)
      ? `Stripe charged AED ${(Number(amount) / 100).toFixed(2)}, order total is AED ${Number(order.total).toFixed(2)}.`
      : "";
  await emailOrder(full, "New PAID website order", note);
  return { marked: "paid", reference: order.reference };
}
