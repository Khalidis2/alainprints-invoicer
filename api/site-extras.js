import { supabaseFetch } from "./_stripe-shared.js";

// Public, read-only extras for the website: approved customer reviews (anonymous) and recently added colours.
const allowedOrigins = new Set(["https://www.printtools3d.com", "https://printtools3d.com"]);
const RECENT_DAYS = 21;

export default async function handler(request, response) {
  const origin = request.headers.origin;
  if (allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });

  const result = { reviews: [], recent: [] };
  try {
    const rows = await supabaseFetch("/rest/v1/settings?key=eq.customer_reviews&select=value&limit=1");
    const list = Array.isArray(rows?.[0]?.value) ? rows[0].value : [];
    result.reviews = list
      .filter((review) => review && review.visible !== false && String(review.text || "").trim())
      .slice(0, 12)
      .map((review) => ({
        rating: Math.min(5, Math.max(1, Math.round(Number(review.rating) || 5))),
        text: String(review.text).trim().slice(0, 400),
        item: String(review.item || "").trim().slice(0, 60),
        date: String(review.date || ""),
      }));
  } catch {
    // reviews are optional
  }
  try {
    const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
    const rows = await supabaseFetch(`/rest/v1/filaments?select=material,color,created_at,remaining_g,spool_weight_g,stock_status,notes&stock_status=eq.available&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=60`);
    const seen = new Set();
    for (const row of rows || []) {
      if (row.notes === "__archived__") continue;
      if (Number(row.remaining_g) < Number(row.spool_weight_g || 1000)) continue;
      const material = String(row.material || "").trim();
      const color = String(row.color || "").trim();
      if (!material || !color || /test/i.test(material) || /test/i.test(color)) continue;
      const key = `${material}|${color}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.recent.push({ material, color, addedAt: row.created_at });
      if (result.recent.length >= 8) break;
    }
  } catch {
    // recently-added row is optional
  }

  response.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  return response.status(200).json(result);
}
