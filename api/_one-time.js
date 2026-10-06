import { env, supabaseFetch } from "./_stripe-shared.js";

// One-time data fixes, run server-side (service key) by the first store visit after a deploy.
// Each fix is guarded by a marker row in `settings`, so it never runs twice and never overwrites later edits.

// Supplier order: 280 spools, USD 2,005.78 (PLA+ 90, PLA Matte 70, PETG Matte 65, Silk Tricolor 50, Marble 5).
const ORDER_USD = 2005.78;
const ORDER_SPOOLS = 280;
const AED_PER_USD = 3.6725;
export const COST_PER_SPOOL = Math.round((ORDER_USD / ORDER_SPOOLS) * AED_PER_USD * 100) / 100; // AED 26.31, before shipping/customs/VAT

export const PRICES = { "PLA+": 55, "PLA Basic": 55, "PLA HS": 55, "PLA Matte": 59, PETG: 67, "PETG Matte": 65, "Silk Tricolor": 79, "PLA Marble": 69 };

const ORDER_LINES = [
  ["KR-PLA102Y-1CH", "PLA+", "Black", 10], ["KR-PLA101Y-1CH", "PLA+", "White", 10], ["KR-PLA117Y-1CH", "PLA+", "Gold", 10],
  ["KR-PLA105Y-1CH", "PLA+", "Gray", 5], ["KR-PLA110Y-1CH", "PLA+", "Silver", 5], ["KR-PLA103Y-1CH", "PLA+", "Red", 5],
  ["KR-PLA104Y-1CH", "PLA+", "Blue", 5], ["KR-PLA107Y-1CH", "PLA+", "Green", 5], ["KR-PLA112Y-1CH", "PLA+", "Purple", 5],
  ["KR-PLA109Y-1CH", "PLA+", "Orange", 5], ["KR-PLA111Y-1CH", "PLA+", "Pink", 5], ["KR-PLA114Y-1CH", "PLA+", "Brown", 5],
  ["KR-PLA108Y-1CH", "PLA+", "Yellow", 5], ["KR-PLA115Y-1CH", "PLA+", "Skin", 5], ["KR-PLA116Y-1CH", "PLA+", "Transparent", 5],
  ["KR-PLA301Y-1CH", "PLA Matte", "Black", 10], ["KR-PLA302Y-1CH", "PLA Matte", "White", 10], ["KR-PLA303Y-1CH", "PLA Matte", "Gray", 7],
  ["KR-PLA304Y-1CH", "PLA Matte", "Blue", 5], ["KR-PLA305Y-1CH", "PLA Matte", "Red", 5], ["KR-PLA306Y-1CH", "PLA Matte", "Green", 5],
  ["KR-PLA307Y-1CH", "PLA Matte", "Skin", 5], ["KR-PLA308Y-1CH", "PLA Matte", "Yellow", 5], ["KR-PLA309Y-1CH", "PLA Matte", "Orange", 5],
  ["KR-PLA310Y-1CH", "PLA Matte", "Lilac Purple", 3], ["KR-PLA311Y-1CH", "PLA Matte", "Grass Green", 5], ["KR-PLA312Y-1CH", "PLA Matte", "Midnight Brown", 5],
  ["KR-PETG301Y-1CH", "PETG Matte", "Black", 30], ["KR-PETG302Y-1CH", "PETG Matte", "White", 35],
  ["KR-Silk210Y-1CH", "Silk Tricolor", "Blue / Green / Orange", 5], ["KR-Silk204Y-1CH", "Silk Tricolor", "Gold / Green / Rose Red", 5],
  ["KR-Silk202Y-1CH", "Silk Tricolor", "Red / Green / Blue", 5], ["KR-Silk213Y-1CH", "Silk Tricolor", "Gold / Green / Black", 5],
  ["KR-Silk214Y-1CH", "Silk Tricolor", "Gold / Green / Blue", 5], ["KR-Silk208Y-1CH", "Silk Tricolor", "Black / Blue / Purple", 5],
  ["KR-Silk215Y-1CH", "Silk Tricolor", "Purple / Red / Blue / Green", 5], ["KR-Silk209Y-1CH", "Silk Tricolor", "Red / Gold / Purple", 5],
  ["KR-Silk201Y-1CH", "Silk Tricolor", "Red / Yellow / Blue", 5], ["KR-Silk212Y-1CH", "Silk Tricolor", "Gold / Purple / Red / Blue", 5],
  ["KR-PLA901Y-1CH", "PLA Marble", "Marble", 5],
];

const MARKER = "supplier_order_costs_prices_v1";
let done = false;

async function hasMarker(key) {
  const rows = await supabaseFetch(`/rest/v1/settings?key=eq.${key}&select=key&limit=1`);
  return Boolean(rows?.length);
}

// Costs and prices for the supplier order. Quantities of existing rows are never changed. Order lines that are
// missing from the inventory (archived or never added) come back as INCOMING so nothing from the invoice is lost,
// and are not for sale until you press Receive.
async function supplierOrder() {
  const now = new Date().toISOString();
  const skus = ORDER_LINES.map((line) => `"${line[0]}"`).join(",");
  const existing = await supabaseFetch(`/rest/v1/filaments?sku=in.(${encodeURIComponent(skus)})&select=id,sku,notes`);
  const bySku = new Map((existing || []).map((row) => [row.sku, row]));

  for (const [sku, material, color, qty] of ORDER_LINES) {
    const row = bySku.get(sku);
    if (row && row.notes !== "__archived__") {
      await supabaseFetch(`/rest/v1/filaments?id=eq.${row.id}`, { method: "PATCH", body: { purchase_cost_per_spool: COST_PER_SPOOL, updated_at: now } });
    } else if (row) {
      await supabaseFetch(`/rest/v1/filaments?id=eq.${row.id}`, {
        method: "PATCH",
        body: { material, color, spool_weight_g: 1000, quantity_spools: qty, remaining_g: 0, purchase_cost_per_spool: COST_PER_SPOOL, selling_price: PRICES[material], stock_status: "incoming", notes: "", updated_at: now },
      });
    } else {
      await supabaseFetch("/rest/v1/filaments", {
        method: "POST",
        body: { sku, brand: "Kingroon", material, color, spool_weight_g: 1000, quantity_spools: qty, remaining_g: 0, purchase_cost_per_spool: COST_PER_SPOOL, selling_price: PRICES[material], stock_status: "incoming", notes: "", updated_at: now },
      });
    }
  }
  for (const [material, price] of Object.entries(PRICES)) {
    await supabaseFetch(`/rest/v1/filaments?material=eq.${encodeURIComponent(material)}&notes=neq.__archived__`, { method: "PATCH", body: { selling_price: price, updated_at: now } });
  }
}

export async function applyOneTimeFixes() {
  if (done || !env("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    if (!(await hasMarker(MARKER))) {
      await supplierOrder();
      await supabaseFetch("/rest/v1/settings", { method: "POST", body: { key: MARKER, value: true } }).catch(() => null);
    }
    done = true;
  } catch {
    // try again on a later visit
  }
}
