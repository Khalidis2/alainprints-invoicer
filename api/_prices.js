import { env, supabaseFetch } from "./_stripe-shared.js";

// Confirmed selling price per spool by type (set once, server-side). Prices only: no quantities or costs are touched,
// and archived rows are skipped. Later manual edits in the Stock tab are not overwritten (marker row).
export const CONFIRMED_PRICES = { "PLA+": 70, "PLA Basic": 70, "PLA HS": 70, "PLA Matte": 70, PETG: 67, "PETG Matte": 75, "Silk Tricolor": 90, "PLA Marble": 75 };
const MARKER = "confirmed_prices_70_67_75_90_v1";
let done = false;

export async function applyConfirmedPricesOnce() {
  if (done || !env("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const marker = await supabaseFetch(`/rest/v1/settings?key=eq.${MARKER}&select=key&limit=1`);
    if (!marker?.length) {
      const now = new Date().toISOString();
      for (const [material, price] of Object.entries(CONFIRMED_PRICES)) {
        await supabaseFetch(`/rest/v1/filaments?material=eq.${encodeURIComponent(material)}&notes=neq.__archived__`, {
          method: "PATCH",
          body: { selling_price: price, updated_at: now },
        });
      }
      await supabaseFetch("/rest/v1/settings", { method: "POST", body: { key: MARKER, value: true } }).catch(() => null);
    }
    done = true;
  } catch {
    // try again on a later visit
  }
}
