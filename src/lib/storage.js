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
    category: row.category,
    price: Number(row.price),
    description: row.description ?? "",
  };
}
function itemToDb(item) {
  return {
    name: item.name,
    category: item.category,
    price: item.price,
    description: item.description ?? "",
  };
}

// ---------- invoices ----------

export async function fetchInvoices() {
  const { data, error } = await supabase.from("invoices").select("*").order("number", { ascending: false });
  if (error) throw error;
  return data.map(dbToInvoice);
}

export async function insertInvoice(invoice) {
  const { data, error } = await supabase.from("invoices").insert(invoiceToDb(invoice)).select().single();
  if (error) throw error;
  return dbToInvoice(data);
}

function dbToInvoice(row) {
  return {
    id: row.id,
    number: row.number,
    date: row.date,
    customer: { name: row.customer_name ?? "", phone: row.customer_phone ?? "" },
    notes: row.notes ?? "",
    total: Number(row.total),
    lines: row.lines ?? [],
  };
}
function invoiceToDb(invoice) {
  return {
    number: invoice.number,
    date: invoice.date,
    customer_name: invoice.customer.name,
    customer_phone: invoice.customer.phone,
    notes: invoice.notes ?? "",
    total: invoice.total,
    lines: invoice.lines,
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
