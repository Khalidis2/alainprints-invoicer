import { env, supabaseFetch } from "./_stripe-shared.js";

// Safety net: undoes the supplier-order update (marker "supplier_order_costs_prices_v1") if, and only if, it ran.
// It touches only values that still equal what that update wrote, so later manual edits are left alone, and it
// never changes any stock quantity of an existing spool.
const MARKER = "supplier_order_costs_prices_v1";
const NEW_PRICES = { "PLA+": 55, "PLA Basic": 55, "PLA HS": 55, "PLA Matte": 59, "PETG Matte": 65, "Silk Tricolor": 79, "PLA Marble": 69 };
const OLD_PRICES = { "PLA+": 70, "PLA Basic": 70, "PLA HS": 70, "PLA Matte": 70, "PETG Matte": 75, "Silk Tricolor": 90, "PLA Marble": 75 };
const NEW_COST = 26.31;
const ADDED_BACK = ["KR-PLA114Y-1CH", "KR-Silk209Y-1CH", "KR-Silk210Y-1CH"]; // were archived before the update

let finished = false;

export async function undoSupplierOrderIfApplied() {
  if (finished || !env("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const marker = await supabaseFetch(`/rest/v1/settings?key=eq.${MARKER}&select=key&limit=1`);
    if (marker?.length) {
      const now = new Date().toISOString();
      for (const [material, price] of Object.entries(NEW_PRICES)) {
        await supabaseFetch(`/rest/v1/filaments?material=eq.${encodeURIComponent(material)}&selling_price=eq.${price}&notes=neq.__archived__`, {
          method: "PATCH",
          body: { selling_price: OLD_PRICES[material], updated_at: now },
        });
      }
      await supabaseFetch(`/rest/v1/filaments?purchase_cost_per_spool=eq.${NEW_COST}`, { method: "PATCH", body: { purchase_cost_per_spool: 0, updated_at: now } });
      const list = encodeURIComponent(ADDED_BACK.map((sku) => `"${sku}"`).join(","));
      await supabaseFetch(`/rest/v1/filaments?sku=in.(${list})&stock_status=eq.incoming&remaining_g=eq.0&notes=eq.`, {
        method: "PATCH",
        body: { quantity_spools: 0, selling_price: 0, purchase_cost_per_spool: 0, notes: "__archived__", updated_at: now },
      });
      await supabaseFetch(`/rest/v1/settings?key=eq.${MARKER}`, { method: "DELETE" });
    }
    finished = true;
  } catch {
    // try again on a later visit
  }
}
