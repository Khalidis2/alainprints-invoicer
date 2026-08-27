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
  if (error.code !== "42883") throw error;

  const fallback = await supabase.from("invoices").insert(payload).select().single();
  if (fallback.error) throw fallback.error;
  return dbToInvoice(fallback.data);
}

export async function updateInvoiceRow(invoice) {
  const payload = invoiceToDb(invoice);
  const { data, error } = await supabase.rpc("save_invoice", { p_id: invoice.id, ...rpcPayload(payload) });
  if (!error) return dbToInvoice(Array.isArray(data) ? data[0] : data);
  if (error.code !== "42883") throw error;

  const fallback = await supabase.from("invoices").update(payload).eq("id", invoice.id).select().single();
  if (fallback.error) throw fallback.error;
  return dbToInvoice(fallback.data);
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
    { itemId: "__invoice_meta__", discount, dueDate: invoice.dueDate ?? "", status: invoice.status ?? "Unpaid" },
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

export function subscribeToChanges({ onItems, onInvoices }) {
  const channel = supabase
    .channel("alainprints-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, onItems)
    .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, onInvoices)
    .subscribe();

  return () => supabase.removeChannel(channel);
}
