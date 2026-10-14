import { env, supabaseFetch } from "./_stripe-shared.js";
import { cors } from "./_store-shared.js";

// A customer's review from the website. It goes to a waiting list (settings key customer_reviews_pending)
// and only shows on the website after the owner approves it in the admin app. No names are collected.
const KEY = "customer_reviews_pending";
const MAX_PENDING = 40;
const clean = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export default async function handler(request, response) {
  cors(request, response, "POST, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }
  response.setHeader("Cache-Control", "no-store");
  if (!env("SUPABASE_SERVICE_ROLE_KEY")) return response.status(503).json({ error: "Reviews are unavailable right now." });

  let body = {};
  try {
    body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  } catch {
    return response.status(400).json({ error: "Invalid review." });
  }
  // Bots fill the hidden field; people never see it. Pretend it worked.
  if (clean(body.website, 50)) return response.status(200).json({ ok: true });

  const text = clean(body.text, 400);
  const rating = Math.round(Number(body.rating));
  const item = clean(body.item, 60);
  if (text.length < 10) return response.status(400).json({ error: "Please write at least a short sentence (10 characters)." });
  if (!(rating >= 1 && rating <= 5)) return response.status(400).json({ error: "Choose 1 to 5 stars." });
  if (/https?:\/\/|www\./i.test(text)) return response.status(400).json({ error: "Please leave out links." });

  try {
    const rows = await supabaseFetch(`/rest/v1/settings?key=eq.${KEY}&select=value&limit=1`);
    const list = Array.isArray(rows?.[0]?.value) ? rows[0].value : [];
    if (list.some((entry) => entry?.text === text)) return response.status(200).json({ ok: true });
    if (list.length >= MAX_PENDING) return response.status(429).json({ error: "Too many reviews are waiting. Please try again later." });
    const next = [...list, { id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, text, rating, item, date: new Date().toISOString().slice(0, 10) }];
    if (rows?.length) await supabaseFetch(`/rest/v1/settings?key=eq.${KEY}`, { method: "PATCH", body: { value: next } });
    else await supabaseFetch("/rest/v1/settings", { method: "POST", body: { key: KEY, value: next } });
    return response.status(200).json({ ok: true });
  } catch {
    return response.status(502).json({ error: "We could not save your review. Please try again." });
  }
}
