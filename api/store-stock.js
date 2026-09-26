export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return response.status(500).json({ error: "Inventory service is not configured" });
  }

  try {
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
    response.setHeader("Access-Control-Allow-Origin", "https://www.printtools3d.com");
    response.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return response.status(200).json({ inventory });
  } catch {
    return response.status(502).json({ error: "Inventory database is unavailable" });
  }
}
