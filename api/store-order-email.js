import { supabaseFetch } from "./_stripe-shared.js";
import { emailOrder, getStoreOrder } from "./_store-shared.js";

// Admin-only: sends the order email for one store order again and returns Resend's exact answer.
export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    await supabaseFetch("/auth/v1/user", { token });
  } catch {
    return response.status(401).json({ error: "Please sign in again." });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const id = String(body.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(400).json({ error: "Missing order" });
    const order = await getStoreOrder(`id=eq.${id}`);
    if (!order) return response.status(404).json({ error: "Order not found" });
    const headline = order.payment_status === "paid" ? "PAID website order (resent)" : "Website order (resent)";
    const result = await emailOrder(order, headline);
    return response.status(200).json({ ok: Boolean(result.sent), reference: order.reference, result });
  } catch (error) {
    return response.status(200).json({ ok: false, result: { failed: error.message } });
  }
}
