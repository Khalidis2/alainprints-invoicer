const allowedOrigins = new Set(["https://www.printtools3d.com", "https://printtools3d.com"]);

export default async function handler(request, response) {
  const origin = request.headers.origin;
  if (allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return response.status(500).json({ error: "Inventory service is not configured" });
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/expire_store_orders`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => null);

    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/public_store_stock`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (!result.ok) {
      return response.status(502).json({ error: "Inventory database is unavailable" });
    }

    const inventory = await result.json();
    response.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return response.status(200).json({ inventory });
  } catch {
    return response.status(502).json({ error: "Inventory database is unavailable" });
  }
}
