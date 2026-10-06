import { supabase } from "./supabaseClient";

// Data layer backed by Supabase, so both PCs read/write the same catalog,
// invoices, and invoice counter. Also subscribes to realtime changes so if
// PC #1 adds an item, PC #2 sees it show up without a refresh.

// ---------- items ----------

export async function fetchItems() {
  const { data, error } = await supabase.from("items").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(dbToItem);
}

export async function insertItem(item) {
  const { data, error } = await supabase.from("items").insert(itemToDb(item)).select().single();
  if (error) throw error;
  return dbToItem(data);
}

export async function updateItemRow(item) {
  const { error } = await supabase.from("items").update(itemToDb(item)).eq("id", item.id);
  if (error) throw error;
}

export async function deleteItemRow(id) {
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw error;
}

function dbToItem(row) {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.name_ar ?? "",
    category: row.category,
    price: Number(row.price),
    description: row.description ?? "",
    imageUrl: row.image_url ?? null,
    publicVisible: Boolean(row.public_visible),
    filamentId: row.filament_id ?? null,
    gramsPerUnit: Number(row.grams_per_unit || 0),
  };
}
function itemToDb(item) {
  return {
    name: item.name,
    name_ar: item.nameAr ?? "",
    category: item.category,
    price: item.price,
    description: item.description ?? "",
    image_url: item.imageUrl ?? null,
    public_visible: Boolean(item.publicVisible),
    filament_id: item.filamentId ?? null,
    grams_per_unit: Number(item.gramsPerUnit || 0),
  };
}

// ---------- item images ----------

export async function uploadItemImage(file) {
  const ext = file.name.split(".").pop();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("item-images").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("item-images").getPublicUrl(path);
  return data.publicUrl;
}



// ---------- customers ----------

function customerKey(customer) {
  const phone = String(customer.phone || "").replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${String(customer.name || "").trim().toLocaleLowerCase()}`;
}

function dbToCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    notes: row.notes ?? "",
    key: row.customer_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchCustomers() {
  const { data, error } = await supabase.from("customers").select("*").order("name", { ascending: true });
  if (error?.code === "42P01") return [];
  if (error) throw error;
  return data.map(dbToCustomer);
}

export async function upsertCustomer(customer) {
  const name = String(customer.name || "").trim();
  if (!name) return null;
  const payload = {
    customer_key: customerKey(customer),
    name,
    phone: String(customer.phone || "").trim(),
    notes: String(customer.notes || "").trim(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("customers")
    .upsert(payload, { onConflict: "customer_key" })
    .select()
    .single();
  if (error) throw error;
  return dbToCustomer(data);
}

export async function updateCustomerRow(customer) {
  const payload = {
    customer_key: customerKey(customer),
    name: String(customer.name || "").trim(),
    phone: String(customer.phone || "").trim(),
    notes: String(customer.notes || "").trim(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("customers").update(payload).eq("id", customer.id).select().single();
  if (error) throw error;
  return dbToCustomer(data);
}



// ---------- filament inventory ----------

const FILAMENT_INVENTORY_SEED_KEY = "filament_inventory_2026_10_02_v1";

const FILAMENT_INVENTORY_2026_10_02 = [
  ["AVAILABLE-MATTE-ORANGE", "Kingroon", "PLA Matte", "Orange", 1, 70],
  ["AVAILABLE-MATTE-RED", "Kingroon", "PLA Matte", "Red", 1, 70],
  ["AVAILABLE-MATTE-BLACK", "Kingroon", "PLA Matte", "Black", 4, 70],
  ["AVAILABLE-MATTE-WHITE", "Kingroon", "PLA Matte", "White", 4, 70],
  ["AVAILABLE-HS-BLACK", "Kingroon", "PLA HS", "Black", 2, 70],
  ["AVAILABLE-HS-WHITE", "Kingroon", "PLA HS", "White", 1, 70],
  ["AVAILABLE-BASIC-SILVER", "Kingroon", "PLA Basic", "Silver", 4, 70],
  ["AVAILABLE-BASIC-WHITE", "Kingroon", "PLA Basic", "White", 2, 70],
  ["AVAILABLE-BASIC-BLACK", "Kingroon", "PLA Basic", "Black", 1, 70],
  ["AVAILABLE-BASIC-RED", "Kingroon", "PLA Basic", "Red", 2, 70],
  ["AVAILABLE-BASIC-GREEN", "Kingroon", "PLA Basic", "Green", 3, 70],
  ["AVAILABLE-BASIC-BROWN", "Kingroon", "PLA Basic", "Brown", 2, 70],
  ["AVAILABLE-BASIC-BLUE", "Kingroon", "PLA Basic", "Blue", 4, 70],
  ["AVAILABLE-PETG-BLUE", "Kingroon", "PETG", "Blue", 7, 67],
  ["AVAILABLE-PETG-WHITE", "Kingroon", "PETG", "White", 1, 67],
  ["AVAILABLE-PETG-GREEN", "Kingroon", "PETG", "Green", 4, 67],
  ["AVAILABLE-PETG-RED", "Kingroon", "PETG", "Red", 3, 67],

  ["KR-PLA102Y-1CH", "Kingroon", "PLA+", "Black", 10, 70],
  ["KR-PLA101Y-1CH", "Kingroon", "PLA+", "White", 10, 70],
  ["KR-PLA117Y-1CH", "Kingroon", "PLA+", "Gold", 10, 70],
  ["KR-PLA105Y-1CH", "Kingroon", "PLA+", "Gray", 5, 70],
  ["KR-PLA110Y-1CH", "Kingroon", "PLA+", "Silver", 10, 70],
  ["KR-PLA103Y-1CH", "Kingroon", "PLA+", "Red", 5, 70],
  ["KR-PLA104Y-1CH", "Kingroon", "PLA+", "Blue", 5, 70],
  ["KR-PLA107Y-1CH", "Kingroon", "PLA+", "Green", 5, 70],
  ["KR-PLA112Y-1CH", "Kingroon", "PLA+", "Purple", 5, 70],
  ["KR-PLA109Y-1CH", "Kingroon", "PLA+", "Orange", 5, 70],
  ["KR-PLA111Y-1CH", "Kingroon", "PLA+", "Pink", 5, 70],
  ["KR-PLA108Y-1CH", "Kingroon", "PLA+", "Yellow", 5, 70],
  ["KR-PLA115Y-1CH", "Kingroon", "PLA+", "Skin", 5, 70],
  ["KR-PLA116Y-1CH", "Kingroon", "PLA+", "Transparent", 5, 70],

  ["KR-PLA301Y-1CH", "Kingroon", "PLA Matte", "Black", 14, 70],
  ["KR-PLA302Y-1CH", "Kingroon", "PLA Matte", "White", 14, 70],
  ["KR-PLA303Y-1CH", "Kingroon", "PLA Matte", "Gray", 7, 70],
  ["KR-PLA304Y-1CH", "Kingroon", "PLA Matte", "Blue", 5, 70],
  ["KR-PLA305Y-1CH", "Kingroon", "PLA Matte", "Red", 5, 70],
  ["KR-PLA306Y-1CH", "Kingroon", "PLA Matte", "Green", 5, 70],
  ["KR-PLA307Y-1CH", "Kingroon", "PLA Matte", "Skin", 5, 70],
  ["KR-PLA308Y-1CH", "Kingroon", "PLA Matte", "Yellow", 5, 70],
  ["KR-PLA309Y-1CH", "Kingroon", "PLA Matte", "Orange", 5, 70],
  ["KR-PLA310Y-1CH", "Kingroon", "PLA Matte", "Lilac Purple", 3, 70],
  ["KR-PLA311Y-1CH", "Kingroon", "PLA Matte", "Grass Green", 5, 70],
  ["KR-PLA312Y-1CH", "Kingroon", "PLA Matte", "Midnight Brown", 5, 70],

  ["KR-PETG301Y-1CH", "Kingroon", "PETG Matte", "Black", 30, 75],
  ["KR-PETG302Y-1CH", "Kingroon", "PETG Matte", "White", 35, 75],
  ["KR-PETG-BASIC-BLACK", "Kingroon", "PETG", "Black", 10, 67],

  ["KR-Silk212Y-1CH", "Kingroon", "Silk Tricolor", "Gold / Purple / Red / Blue", 5, 90],
  ["KR-Silk202Y-1CH", "Kingroon", "Silk Tricolor", "Red / Green / Blue", 5, 90],
  ["KR-Silk215Y-1CH", "Kingroon", "Silk Tricolor", "Purple / Red / Blue / Green", 5, 90],
  ["KR-Silk201Y-1CH", "Kingroon", "Silk Tricolor", "Red / Yellow / Blue", 5, 90],
  ["KR-Silk208Y-1CH", "Kingroon", "Silk Tricolor", "Black / Blue / Purple", 10, 90],
  ["KR-Silk204Y-1CH", "Kingroon", "Silk Tricolor", "Gold / Green / Rose Red", 5, 90],
  ["KR-Silk213Y-1CH", "Kingroon", "Silk Tricolor", "Gold / Green / Black", 5, 90],
  ["KR-Silk214Y-1CH", "Kingroon", "Silk Tricolor", "Gold / Green / Blue", 5, 90],

  ["KR-PLA901Y-1CH", "Kingroon", "PLA Marble", "Marble", 5, 75],
];

const OBSOLETE_FILAMENT_SKUS = [
  "KR-PLA114Y-1CH",
  "KR-PETG303Y-1CH",
  "KR-PETG304Y-1CH",
  "KR-PETG305Y-1CH",
  "KR-PETG306Y-1CH",
  "KR-PETG307Y-1CH",
  "KR-PETG308Y-1CH",
  "KR-PETG309Y-1CH",
  "KR-PETG310Y-1CH",
  "KR-PETG311Y-1CH",
  "KR-PETG312Y-1CH",
  "KR-Silk210Y-1CH",
  "KR-Silk209Y-1CH",
];

export async function syncFilamentInventoryOnce() {
  const { data: marker, error: markerError } = await supabase
    .from("settings")
    .select("key")
    .eq("key", FILAMENT_INVENTORY_SEED_KEY)
    .maybeSingle();
  if (markerError) throw markerError;
  if (marker) return false;

  const now = new Date().toISOString();

  const { error: archiveError } = await supabase
    .from("filaments")
    .update({
      quantity_spools: 0,
      remaining_g: 0,
      selling_price: 0,
      notes: "__archived__",
      updated_at: now,
    })
    .in("sku", OBSOLETE_FILAMENT_SKUS);
  if (archiveError) throw archiveError;

  const rows = FILAMENT_INVENTORY_2026_10_02.map(([sku, brand, material, color, quantity, price]) => ({
    sku,
    brand,
    material,
    color,
    spool_weight_g: 1000,
    quantity_spools: quantity,
    remaining_g: quantity * 1000,
    selling_price: price,
    stock_status: "available",
    notes: "",
    updated_at: now,
  }));

  const { error: upsertError } = await supabase
    .from("filaments")
    .upsert(rows, { onConflict: "sku" });
  if (upsertError) throw upsertError;

  const { error: settingsError } = await supabase
    .from("settings")
    .upsert({ key: FILAMENT_INVENTORY_SEED_KEY, value: true }, { onConflict: "key" });
  if (settingsError) throw settingsError;

  return true;
}

// One-time tidy-up: every filament becomes Kingroon. Unbranded ("Kingroon") stock is added to the
// matching Kingroon colour (same material + colour) and its old row is archived, so each colour appears once.
const KINGROON_MERGE_KEY = "filament_all_kingroon_v1";

export async function makeAllFilamentKingroon() {
  const { data: marker, error: markerError } = await supabase.from("settings").select("key").eq("key", KINGROON_MERGE_KEY).maybeSingle();
  if (markerError) throw markerError;
  if (marker) return false;

  const { data: rows, error } = await supabase.from("filaments").select("*").neq("notes", "__archived__");
  if (error) throw error;
  const live = rows.filter((row) => row.sku !== TEST_SPOOL_SKU && row.material !== "Payment Test");
  const keyOf = (row) => `${String(row.material).trim().toLowerCase()}|${String(row.color).trim().toLowerCase()}`;
  const kingroon = new Map(live.filter((row) => row.brand === "Kingroon").map((row) => [keyOf(row), row]));
  const now = new Date().toISOString();

  for (const row of live.filter((entry) => entry.brand !== "Kingroon")) {
    const target = kingroon.get(keyOf(row));
    const grams = Number(row.remaining_g) || 0;
    if (target) {
      const { error: addError } = await supabase.from("filaments")
        .update({ remaining_g: Number(target.remaining_g) + grams, quantity_spools: Number(target.quantity_spools) + Number(row.quantity_spools), updated_at: now })
        .eq("id", target.id);
      if (addError) throw addError;
      target.remaining_g = Number(target.remaining_g) + grams;
      target.quantity_spools = Number(target.quantity_spools) + Number(row.quantity_spools);
      if (grams) {
        const { error: moveError } = await supabase.from("inventory_movements").insert([
          { filament_id: target.id, grams_delta: grams, reason: `Merged unbranded ${row.material} ${row.color} stock into Kingroon` },
          { filament_id: row.id, grams_delta: -grams, reason: "Merged into the Kingroon row" },
        ]);
        if (moveError) throw moveError;
      }
      const { error: archiveError } = await supabase.from("filaments")
        .update({ remaining_g: 0, quantity_spools: 0, selling_price: 0, stock_status: "incoming", notes: "__archived__", updated_at: now })
        .eq("id", row.id);
      if (archiveError) throw archiveError;
    } else {
      const { error: brandError } = await supabase.from("filaments").update({ brand: "Kingroon", updated_at: now }).eq("id", row.id);
      if (brandError) throw brandError;
      kingroon.set(keyOf(row), row);
    }
  }

  const { error: settingsError } = await supabase.from("settings").upsert({ key: KINGROON_MERGE_KEY, value: true }, { onConflict: "key" });
  if (settingsError) throw settingsError;
  return true;
}

// One-time: PETG Basic sells at AED 67 per spool (PETG Matte keeps its own price).
const PETG_PRICE_KEY = "petg_basic_price_67_v1";

export async function setPetgBasicPrice() {
  const { data: marker, error: markerError } = await supabase.from("settings").select("key").eq("key", PETG_PRICE_KEY).maybeSingle();
  if (markerError) throw markerError;
  if (marker) return false;
  const { error } = await supabase.from("filaments")
    .update({ selling_price: 67, updated_at: new Date().toISOString() })
    .eq("material", "PETG")
    .neq("notes", "__archived__");
  if (error) throw error;
  const { error: settingsError } = await supabase.from("settings").upsert({ key: PETG_PRICE_KEY, value: true }, { onConflict: "key" });
  if (settingsError) throw settingsError;
  return true;
}

export async function fetchFilaments() {
  const { data, error } = await supabase
    .from("filaments")
    .select("*")
    .neq("notes", "__archived__")
    .order("stock_status", { ascending: true })
    .order("material", { ascending: true })
    .order("color", { ascending: true });
  if (error?.code === "42P01") return [];
  if (error) throw error;
  return data.map(dbToFilament);
}

export async function updateFilamentRow(filament) {
  const payload = {
    sku: filament.sku || null,
    brand: filament.brand,
    material: filament.material,
    color: filament.color,
    spool_weight_g: Number(filament.spoolWeightG || 1000),
    quantity_spools: Number(filament.quantitySpools || 0),
    remaining_g: Number(filament.remainingG || 0),
    purchase_cost_per_spool: Number(filament.purchaseCost || 0),
    selling_price: Number(filament.sellingPrice || 0),
    stock_status: filament.stockStatus,
    location: filament.location || "",
    expected_date: filament.expectedDate || null,
    notes: filament.notes || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("filaments").update(payload).eq("id", filament.id).select().single();
  if (error) throw error;
  return dbToFilament(data);
}

// Add a new colour/type. Starts as a normal row; `status` is "available" (in stock now) or "incoming" (on order).
export async function addFilamentRow({ material, color, spools, sellingPrice, purchaseCost, status, brand = "Kingroon", location = "", notes = "" }) {
  const count = Math.max(0, Number(spools) || 0);
  const now = new Date().toISOString();
  const row = {
    sku: `AP-${Date.now().toString(36).toUpperCase()}`,
    brand,
    material: String(material).trim(),
    color: String(color).trim(),
    spool_weight_g: 1000,
    quantity_spools: count,
    remaining_g: status === "available" ? count * 1000 : 0,
    purchase_cost_per_spool: Number(purchaseCost) || 0,
    selling_price: Number(sellingPrice) || 0,
    stock_status: status === "incoming" ? "incoming" : "available",
    location,
    notes,
    updated_at: now,
  };
  const { data, error } = await supabase.from("filaments").insert(row).select().single();
  if (error) throw error;
  return dbToFilament(data);
}

// "Remove" never deletes data: the row is archived (hidden from stock and the shop) and can be restored.
export async function archiveFilamentRow(id) {
  const { error } = await supabase.from("filaments")
    .update({ notes: "__archived__", remaining_g: 0, quantity_spools: 0, stock_status: "incoming", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreFilamentRow(id) {
  const { error } = await supabase.from("filaments").update({ notes: "", stock_status: "available", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function fetchArchivedFilaments() {
  const { data, error } = await supabase.from("filaments").select("*").eq("notes", "__archived__").order("material", { ascending: true }).order("color", { ascending: true });
  if (error) throw error;
  return data.map(dbToFilament);
}

export async function receiveFilamentRow(filament) {
  const totalGrams = Number(filament.quantitySpools || 0) * Number(filament.spoolWeightG || 1000);
  const { data, error } = await supabase
    .from("filaments")
    .update({ stock_status: "available", remaining_g: totalGrams, updated_at: new Date().toISOString() })
    .eq("id", filament.id)
    .select()
    .single();
  if (error) throw error;
  return dbToFilament(data);
}

function dbToFilament(row) {
  return {
    id: row.id,
    sku: row.sku ?? "",
    brand: row.brand,
    material: row.material,
    color: row.color,
    spoolWeightG: Number(row.spool_weight_g),
    quantitySpools: Number(row.quantity_spools),
    remainingG: Number(row.remaining_g),
    purchaseCost: Number(row.purchase_cost_per_spool),
    sellingPrice: Number(row.selling_price),
    stockStatus: row.stock_status,
    location: row.location ?? "",
    expectedDate: row.expected_date ?? "",
    notes: row.notes ?? "",
  };
}

// ---------- store orders ----------

export async function fetchStoreOrders() {
  // Release reservations whose time ran out first, so the list never shows them as pending.
  try { await supabase.rpc("expire_store_orders"); } catch { /* best effort */ }
  const { data, error } = await supabase
    .from("store_orders")
    .select("*, store_order_items(*)")
    .order("created_at", { ascending: false });
  if (error?.code === "42P01") return [];
  if (error) throw error;
  return data;
}

export async function setStoreOrderStatus(id, status) {
  const { data, error } = await supabase.rpc("set_store_order_status", { p_order_id: id, p_status: status });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// Owner payment test: one AED 2 spool that shows in the store like any other product.
const TEST_SPOOL_SKU = "TEST-2AED";

export async function setTestSpool(on) {
  // Retire the earlier hand-made "PLA Basic · TEST" spool so only the payment-test item remains.
  const { error: legacyError } = await supabase
    .from("filaments")
    .update({ stock_status: "incoming", remaining_g: 0, quantity_spools: 0, updated_at: new Date().toISOString() })
    .eq("material", "PLA Basic")
    .eq("color", "TEST");
  if (legacyError) throw legacyError;
  const now = new Date().toISOString();
  if (on) {
    const { error } = await supabase.from("filaments").upsert(
      { sku: TEST_SPOOL_SKU, brand: "Test", material: "Payment Test", color: "AED 2 checkout", spool_weight_g: 1000, quantity_spools: 1, remaining_g: 1000, selling_price: 2, stock_status: "available", notes: "AED 2 payment test", updated_at: now },
      { onConflict: "sku" },
    );
    if (error) throw error;
    return;
  }
  // Off: update the existing row only (an upsert would try to insert a row without a material).
  const { error } = await supabase
    .from("filaments")
    .update({ stock_status: "incoming", remaining_g: 0, quantity_spools: 0, updated_at: now })
    .eq("sku", TEST_SPOOL_SKU);
  if (error) throw error;
}

// ---------- invoices ----------

export async function fetchInvoices() {
  const { data, error } = await supabase.from("invoices").select("*").order("number", { ascending: false });
  if (error) throw error;
  return data.map(dbToInvoice);
}

export async function insertInvoice(invoice) {
  const payload = invoiceToDb(invoice);
  const { data, error } = await supabase.rpc("save_invoice", { p_id: null, ...rpcPayload(payload) });
  if (!error) return dbToInvoice(Array.isArray(data) ? data[0] : data);
  throw invoiceSaveError(error);
}

export async function updateInvoiceRow(invoice) {
  const payload = invoiceToDb(invoice);
  const { data, error } = await supabase.rpc("save_invoice", { p_id: invoice.id, ...rpcPayload(payload) });
  if (!error) return dbToInvoice(Array.isArray(data) ? data[0] : data);
  throw invoiceSaveError(error);
}

// Never fall back to a plain insert/update: that would save the invoice without moving stock,
// so the website would keep selling spools that were already invoiced.
function invoiceSaveError(error) {
  if (error?.code === "42883" || error?.code === "PGRST202") {
    return new Error("Stock sync is not installed in Supabase. Run supabase/filament_inventory_upgrade.sql in the SQL Editor, then save again. The invoice was NOT saved, so stock stays correct.");
  }
  if (/Not enough available filament stock/i.test(error?.message || "")) {
    return new Error("Not enough filament in stock for this invoice. Check the Stock tab, then try again.");
  }
  return error;
}

function rpcPayload(payload) {
  return {
    p_number: payload.number,
    p_date: payload.date,
    p_customer_name: payload.customer_name,
    p_customer_phone: payload.customer_phone,
    p_notes: payload.notes,
    p_total: payload.total,
    p_lines: payload.lines,
  };
}

export async function deleteInvoiceRow(id) {
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;
}

function dbToInvoice(row) {
  const storedLines = row.lines ?? [];
  const invoiceMeta = storedLines.find((line) => line.itemId === "__invoice_meta__");
  const discountMeta = storedLines.find((line) => line.itemId === "__invoice_discount__");
  const discount = Math.max(0, Number(invoiceMeta?.discount ?? discountMeta?.amount) || 0);
  const total = Number(row.total);
  return {
    id: row.id,
    number: row.number,
    date: row.date,
    customer: { name: row.customer_name ?? "", phone: row.customer_phone ?? "" },
    notes: row.notes ?? "",
    dueDate: invoiceMeta?.dueDate ?? "",
    status: invoiceMeta?.status ?? "Unpaid",
    paymentMethod: invoiceMeta?.paymentMethod ?? "",
    paidDate: invoiceMeta?.paidDate ?? "",
    paymentReference: invoiceMeta?.paymentReference ?? "",
    stripeLinkId: invoiceMeta?.stripeLinkId ?? "",
    stripeLinkUrl: invoiceMeta?.stripeLinkUrl ?? "",
    stripeLinkAmount: Number(invoiceMeta?.stripeLinkAmount) || 0,
    stripePaymentIntent: invoiceMeta?.stripePaymentIntent ?? "",
    stripeRefundedAmount: Number(invoiceMeta?.stripeRefundedAmount) || 0,
    refundedDate: invoiceMeta?.refundedDate ?? "",
    subtotal: total + discount,
    discount,
    total,
    lines: storedLines.filter((line) => !["__invoice_discount__", "__invoice_meta__"].includes(line.itemId)),
  };
}
function invoiceToDb(invoice) {
  const discount = Math.max(0, Number(invoice.discount) || 0);
  const lines = [
    ...invoice.lines,
    {
      itemId: "__invoice_meta__",
      discount,
      dueDate: invoice.dueDate ?? "",
      status: invoice.status ?? "Unpaid",
      paymentMethod: invoice.paymentMethod ?? "",
      paidDate: invoice.paidDate ?? "",
      paymentReference: invoice.paymentReference ?? "",
      // Keep the Stripe link attached when the invoice is edited or its status changes.
      ...(invoice.stripeLinkId ? { stripeLinkId: invoice.stripeLinkId, stripeLinkUrl: invoice.stripeLinkUrl, stripeLinkAmount: invoice.stripeLinkAmount } : {}),
      ...(invoice.stripePaymentIntent ? { stripePaymentIntent: invoice.stripePaymentIntent } : {}),
      ...(invoice.stripeRefundedAmount ? { stripeRefundedAmount: invoice.stripeRefundedAmount, refundedDate: invoice.refundedDate } : {}),
    },
  ];
  return {
    number: invoice.number,
    date: invoice.date,
    customer_name: invoice.customer.name,
    customer_phone: invoice.customer.phone,
    notes: invoice.notes ?? "",
    total: invoice.total,
    lines,
  };
}

// ---------- invoice counter ----------
// Read-then-write. Fine for two people on the same small team; if two
// invoices could ever be finalized in the exact same instant, this is
// the place to replace with a Postgres RPC that increments atomically.

export async function fetchInvoiceNo() {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "invoice_no").single();
  if (error) throw error;
  return Number(data.value);
}

export async function persistInvoiceNo(n) {
  const { error } = await supabase.from("settings").update({ value: n }).eq("key", "invoice_no");
  if (error) throw error;
}

// ---------- realtime ----------

export function subscribeToChanges({ onItems, onInvoices, onCustomers, onFilaments, onStoreOrders }) {
  const channel = supabase
    .channel("alainprints-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, onItems)
    .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, onInvoices)
    .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, onCustomers)
    .on("postgres_changes", { event: "*", schema: "public", table: "filaments" }, onFilaments)
    .on("postgres_changes", { event: "*", schema: "public", table: "store_orders" }, onStoreOrders)
    .subscribe();

  return () => supabase.removeChannel(channel);
}


export async function fetchWebsiteSettings() {
  const { data, error } = await supabase.from("settings").select("key,value").in("key", ["store_open", "announcement_banner"]);
  if (error) throw error;
  const values = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return {
    storeOpen: values.store_open !== false,
    announcement: typeof values.announcement_banner === "string" ? values.announcement_banner : "",
  };
}

export async function saveWebsiteSettings(settings) {
  const rows = [
    { key: "store_open", value: Boolean(settings.storeOpen) },
    { key: "announcement_banner", value: String(settings.announcement || "").trim() },
  ];
  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}


// ---------- Stripe payment link ----------
// Asks our server (which holds the Stripe key) for a one-time payment link for this invoice.
export async function checkStripePayment(invoiceId) {
  return callStripeApi({ invoiceId, action: "check" });
}

export async function syncStripeRefunds() {
  return callStripeApi({ action: "refunds" });
}

export async function createPaymentLink(invoiceId) {
  return (await callStripeApi({ invoiceId })).url;
}

async function callStripeApi(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch("/api/stripe-payment-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Stripe request failed.");
  return result;
}

export async function sendTestEmail() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch("/api/email-test", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  return response.json();
}

// Re-send the email for one website order; resolves with a short message for the toast.
export async function resendOrderEmail(id) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const response = await fetch("/api/store-order-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id }),
  });
  const result = await response.json().catch(() => ({}));
  if (result.ok) return `Email sent for ${result.reference}. Check your inbox and spam.`;
  const r = result.result || {};
  if (r.skipped) return `Not sent: ${r.skipped}.`;
  const detail = typeof r.detail === "string" ? r.detail.slice(0, 220) : "";
  return `Not sent: ${result.error || (r.failed ? `Resend ${r.failed}` : "unknown error")}${detail ? ` - ${detail}` : ""}`;
}

// Real Stripe fee and net amount per payment (from Stripe's balance transaction). Cached for the session.
const feeCache = new Map();
export async function fetchStripeFees(paymentIntents) {
  const wanted = [...new Set(paymentIntents.filter(Boolean))];
  const missing = wanted.filter((id) => !feeCache.has(id) || feeCache.get(id)?.pending);
  for (let index = 0; index < missing.length; index += 30) {
    const chunk = missing.slice(index, index + 30);
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const response = await fetch("/api/stripe-fees", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ paymentIntents: chunk }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Couldn't load Stripe fees");
    for (const [id, value] of Object.entries(result.fees || {})) feeCache.set(id, value);
  }
  return Object.fromEntries(wanted.map((id) => [id, feeCache.get(id)]));
}
