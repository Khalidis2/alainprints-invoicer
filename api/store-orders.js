import { cors, createStoreOrder, emailOrder, getStoreOrder } from "./_store-shared.js";

// Website order paid later (WhatsApp / transfer). Reserves stock, emails the shop.
export default async function handler(request, response) {
  cors(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const order = await createStoreOrder(body);
    const full = (await getStoreOrder(`id=eq.${order.id}`).catch(() => null)) || order;
    await emailOrder(full, "New website order (WhatsApp)");

    response.setHeader("Cache-Control", "no-store");
    return response.status(201).json({
      id: order.id,
      reference: order.reference,
      subtotal: Number(order.subtotal),
      shipping: Number(order.shipping),
      total: Number(order.total),
      status: order.status,
      expiresAt: order.expires_at,
    });
  } catch (error) {
    return response.status(error.status || 502).json({ error: error.status ? error.message : "Order database is unavailable" });
  }
}
