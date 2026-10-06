import { env, supabaseFetch } from "./_stripe-shared.js";
import { undoSupplierOrderIfApplied } from "./_undo-supplier.js";
import { applyConfirmedPricesOnce } from "./_prices.js";

// One-time server-side price fix (PETG Basic = AED 67), run by the first store visit after deploy so nobody
// has to open the admin app. Same marker as the admin app's update, so it never runs twice.
const PETG_PRICE_KEY = "petg_basic_price_67_v1";
let petgPriceDone = false;
async function applyPetgPriceOnce() {
  if (petgPriceDone || !env("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const marker = await supabaseFetch(`/rest/v1/settings?key=eq.${PETG_PRICE_KEY}&select=key&limit=1`);
    if (!marker?.length) {
      await supabaseFetch("/rest/v1/filaments?material=eq.PETG&notes=neq.__archived__", { method: "PATCH", body: { selling_price: 67, updated_at: new Date().toISOString() } });
      await supabaseFetch("/rest/v1/settings", { method: "POST", body: { key: PETG_PRICE_KEY, value: true } }).catch(() => null);
    }
    petgPriceDone = true;
  } catch {
    // try again on a later visit
  }
}

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
    await undoSupplierOrderIfApplied();
    await applyPetgPriceOnce();
    await applyConfirmedPricesOnce();
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
    response.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");
    return response.status(200).json({ inventory });
  } catch {
    return response.status(502).json({ error: "Inventory database is unavailable" });
  }
}
