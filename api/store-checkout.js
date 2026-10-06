import { env, stripe } from "./_stripe-shared.js";
import { SITE_URL, cors, createStoreOrder, getStoreOrder, markStoreOrderPaid, updateStoreOrder } from "./_store-shared.js";

// POST: reserve the website order and open Stripe Checkout for it.
// GET ?session_id=: what the thank-you page shows (and a backup check that payment arrived).
export default async function handler(request, response) {
  cors(request, response, "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  response.setHeader("Cache-Control", "no-store");

  try {
    if (request.method === "GET") return await status(request, response);
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST, OPTIONS");
      return response.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    // Fail before reserving stock: without the service key the order can't be read back, paid or released.
    if (!env("SUPABASE_SERVICE_ROLE_KEY")) {
      return response.status(503).json({ error: "Card payment is not set up yet. Please order on WhatsApp." });
    }
    const created = await createStoreOrder(body);
    const order = (await getStoreOrder(`id=eq.${created.id}`)) || created;
    const items = order.store_order_items || [];

    // Keep the reservation alive a little longer than the Stripe page (Stripe's minimum is 30 minutes).
    const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
    await updateStoreOrder(order.id, { payment_method: "card", expires_at: new Date((expiresAt + 5 * 60) * 1000).toISOString() });

    const lineItems = {};
    items.forEach((item, index) => {
      lineItems[index] = {
        quantity: item.quantity,
        price_data: {
          currency: "aed",
          unit_amount: Math.round(Number(item.unit_price) * 100),
          product_data: { name: `${item.brand ? `${item.brand} ` : ""}${item.material} · ${item.color} (1 kg spool)` },
        },
      };
    });
    if (Number(order.shipping) > 0) {
      lineItems[items.length] = {
        quantity: 1,
        price_data: { currency: "aed", unit_amount: Math.round(Number(order.shipping) * 100), product_data: { name: "UAE delivery" } },
      };
    }

    const ids = { store_order_id: order.id, store_order_reference: order.reference };
    const session = await stripe("/checkout/sessions", {
      method: "POST",
      params: {
        mode: "payment",
        line_items: lineItems,
        metadata: ids,
        payment_intent_data: { metadata: ids, description: `printtools3d order ${order.reference}` },
        client_reference_id: order.reference,
        expires_at: expiresAt,
        success_url: `${SITE_URL}/store/order-success?ref=${encodeURIComponent(order.reference)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/store?payment=cancelled#build-order`,
      },
    });
    await updateStoreOrder(order.id, { stripe_session_id: session.id });

    return response.status(201).json({ url: session.url, reference: order.reference, total: Number(order.total) });
  } catch (error) {
    return response.status(error.status && error.status < 500 ? error.status : 502).json({ error: error.message || "Checkout is unavailable" });
  }
}

async function status(request, response) {
  const sessionId = String(request.query?.session_id || new URL(request.url, "http://x").searchParams.get("session_id") || "");
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return response.status(400).json({ error: "Missing payment session" });
  let order = await getStoreOrder(`stripe_session_id=eq.${encodeURIComponent(sessionId)}`);
  if (!order) return response.status(404).json({ error: "Order not found" });

  if (order.payment_status !== "paid") {
    // Webhook may still be on its way: ask Stripe directly.
    const session = await stripe(`/checkout/sessions/${sessionId}`).catch(() => null);
    if (session?.payment_status === "paid") {
      await markStoreOrderPaid(order, { paymentIntent: session.payment_intent, sessionId, amount: session.amount_total, customerEmail: session.customer_details?.email || session.customer_email });
      order = { ...order, payment_status: "paid" };
    }
  }

  return response.status(200).json({
    reference: order.reference,
    paid: order.payment_status === "paid",
    total: Number(order.total),
    name: order.customer_name,
    items: (order.store_order_items || []).map((item) => ({ material: item.material, color: item.color, quantity: item.quantity })),
  });
}
