// Shared helpers for the Stripe endpoints. Files starting with "_" are not public endpoints on Vercel.

export const META_ID = "__invoice_meta__";

export function env(name) {
  return process.env[name] || "";
}

export function supabaseConfig() {
  return {
    url: env("VITE_SUPABASE_URL") || env("SUPABASE_URL"),
    anonKey: env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY"),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

// Calls Supabase REST with either the logged-in user's token or the service role key.
export async function supabaseFetch(path, { token, method = "GET", body } = {}) {
  const { url, anonKey, serviceKey } = supabaseConfig();
  const key = token ? anonKey : serviceKey;
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || serviceKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Supabase ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getInvoiceRow(id, token) {
  const rows = await supabaseFetch(`/rest/v1/invoices?id=eq.${encodeURIComponent(id)}&select=*`, { token });
  return rows?.[0] || null;
}

export function readMeta(row) {
  return (row.lines || []).find((line) => line.itemId === META_ID) || { itemId: META_ID };
}

// Saves through save_invoice so stock is reconciled exactly like a save from the app.
export async function saveInvoiceMeta(row, patch, token) {
  const lines = (row.lines || []).filter((line) => line.itemId !== META_ID);
  const meta = { ...readMeta(row), ...patch, itemId: META_ID };
  const result = await supabaseFetch("/rest/v1/rpc/save_invoice", {
    token,
    method: "POST",
    body: {
      p_id: row.id,
      p_number: row.number,
      p_date: row.date,
      p_customer_name: row.customer_name,
      p_customer_phone: row.customer_phone,
      p_notes: row.notes ?? "",
      p_total: row.total,
      p_lines: [...lines, meta],
    },
  });
  return Array.isArray(result) ? result[0] : result;
}

// Minimal Stripe REST client (form-encoded), so no extra dependency is needed.
export async function stripe(path, { method = "GET", params } = {}) {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in Vercel.");
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function flatten(object, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") flatten(value, name, out);
    else out[name] = String(value);
  }
  return out;
}

export function uaeDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
}
