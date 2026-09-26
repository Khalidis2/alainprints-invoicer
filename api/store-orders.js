const allowedOrigins = new Set(["https://www.printtools3d.com", "https://printtools3d.com"]);

export default async function handler(request, response) {
  const origin = request.headers.origin;
  if (allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return response.status(500).json({ error: "Order service is not configured" });

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 20) return response.status(400).json({ error: "Select at least one product" });

  try {
    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/create_store_order`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_customer_name: String(body.customer?.name || ""),
        p_mobile: String(body.customer?.mobile || ""),
        p_emirate: String(body.customer?.emirate || ""),
        p_address: String(body.customer?.address || ""),
        p_notes: String(body.customer?.notes || ""),
        p_items: items.map((item) => ({
          material: String(item.material || ""),
          color: String(item.color || ""),
          quantity: Number(item.quantity || 0),
        })),
      }),
    });

    const data = await result.json();
    if (!result.ok) {
      const message = String(data?.message || data?.error || "Order could not be reserved");
      return response.status(message.includes("stock") ? 409 : 400).json({ error: message });
    }

    const order = Array.isArray(data) ? data[0] : data;
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
  } catch {
    return response.status(502).json({ error: "Order database is unavailable" });
  }
}
