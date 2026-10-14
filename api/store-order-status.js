import { cors, getStoreOrder } from "./_store-shared.js";

// "Track my order" on the website. The customer gives the order number and the last 4 digits of the
// mobile number they ordered with; only the order's status and items come back, never personal details.
export default async function handler(request, response) {
  cors(request, response, "GET, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }
  response.setHeader("Cache-Control", "no-store");

  const reference = String(request.query?.ref || "").trim().toUpperCase();
  const last4 = String(request.query?.phone || "").replace(/\D/g, "").slice(-4);
  if (!/^PT-[A-Z0-9-]{4,40}$/.test(reference) || last4.length !== 4) {
    return response.status(400).json({ error: "Enter your order number and the last 4 digits of your mobile number." });
  }

  try {
    const order = await getStoreOrder(`reference=eq.${encodeURIComponent(reference)}`);
    const mobile = String(order?.mobile || "").replace(/\D/g, "");
    // Same answer for "no such order" and "wrong digits", so order numbers cannot be guessed.
    if (!order || !mobile.endsWith(last4)) return response.status(404).json({ error: "We could not find that order. Check the number and the last 4 digits of your mobile." });

    return response.status(200).json({
      reference: order.reference,
      status: order.status,
      paid: order.payment_status === "paid",
      refunded: order.payment_status === "refunded",
      total: Number(order.total),
      createdAt: order.created_at,
      expiresAt: order.status === "pending" ? order.expires_at : null,
      items: (order.store_order_items || []).map((item) => ({ material: item.material, color: item.color, quantity: item.quantity })),
    });
  } catch (error) {
    return response.status(error.status && error.status < 500 ? error.status : 502).json({ error: "Order lookup is unavailable right now." });
  }
}
