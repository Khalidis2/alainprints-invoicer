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
  if (!url || !key) {
    throw Object.assign(
      new Error(token ? "VITE_SUPABASE_ANON_KEY is not set in Vercel." : "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel (Project Settings > Environment Variables), then redeploy."),
      { status: 500 },
    );
  }
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

// Payment details live in real columns on the invoice row. Rows read before the
// invoice_columns.sql migration has run still carry them in the old meta line, so fall back to that.
export function readMeta(row) {
  if (row && "status" in row) {
    return {
      itemId: META_ID,
      status: row.status || "Unpaid",
      dueDate: row.due_date || "",
      discount: Number(row.discount) || 0,
      paymentMethod: row.payment_method || "",
      paidDate: row.paid_date || "",
      paymentReference: row.payment_reference || "",
      stripeLinkId: row.stripe_link_id || "",
      stripeLinkUrl: row.stripe_link_url || "",
      stripeLinkAmount: Number(row.stripe_link_amount) || 0,
      stripePaymentIntent: row.stripe_payment_intent || "",
      stripeRefundedAmount: Number(row.stripe_refunded_amount) || 0,
      refundedDate: row.refunded_date || "",
    };
  }
  return (row.lines || []).find((line) => line.itemId === META_ID) || { itemId: META_ID };
}

// Column values for a meta object (used for direct updates that must not touch stock).
export function metaToColumns(meta) {
  const date = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : null);
  return {
    status: meta.status || "Unpaid",
    due_date: date(meta.dueDate),
    discount: Number(meta.discount) || 0,
    payment_method: meta.paymentMethod || "",
    paid_date: date(meta.paidDate),
    payment_reference: meta.paymentReference || "",
    stripe_link_id: meta.stripeLinkId || "",
    stripe_link_url: meta.stripeLinkUrl || "",
    stripe_link_amount: Number(meta.stripeLinkAmount) || 0,
    stripe_payment_intent: meta.stripePaymentIntent || "",
    stripe_refunded_amount: Number(meta.stripeRefundedAmount) || 0,
    refunded_date: date(meta.refundedDate),
  };
}

// True once invoice_columns.sql has been run in Supabase.
export function hasInvoiceColumns(row) {
  return Boolean(row) && "status" in row;
}

// Finds an invoice whose column equals value; before the migration, searches the old meta line instead.
export async function findInvoiceBy(column, jsonKey, value, token) {
  if (!value) return null;
  try {
    const rows = await supabaseFetch(`/rest/v1/invoices?${column}=eq.${encodeURIComponent(value)}&select=*`, { token });
    return rows?.[0] || null;
  } catch (error) {
    if (error.status !== 400) throw error; // 400 = column does not exist yet
    const filter = encodeURIComponent(JSON.stringify([{ [jsonKey]: value }]));
    const rows = await supabaseFetch(`/rest/v1/invoices?lines=cs.${filter}&select=*`, { token });
    return rows?.[0] || null;
  }
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

// ---------- refunds ----------
export async function findInvoiceByPaymentIntent(paymentIntent, token) {
  if (!paymentIntent) return null;
  return (await findInvoiceBy("stripe_payment_intent", "stripePaymentIntent", paymentIntent, token))
    || (await findInvoiceBy("payment_reference", "paymentReference", paymentIntent, token));
}

// Full refund -> "Refunded" (save_invoice puts spools back in stock). Partial refund -> stays Paid, amount noted.
export async function applyRefund(charge, token) {
  const row = await findInvoiceByPaymentIntent(charge.payment_intent, token);
  if (!row) return { ignored: "No matching invoice" };
  const meta = readMeta(row);
  const refunded = Number(charge.amount_refunded) || 0;
  const full = charge.refunded === true || refunded >= Number(charge.amount);
  if (meta.status === "Refunded" || (!full && Number(meta.stripeRefundedAmount) === refunded)) return { already: true, invoice: row.number };
  const refundedDate = uaeDate(Math.floor(Date.now() / 1000));
  await saveInvoiceMeta(row, full
    ? { status: "Refunded", stripeRefundedAmount: refunded, refundedDate }
    : { stripeRefundedAmount: refunded, refundedDate }, token);
  return { marked: full ? "Refunded" : "Partly refunded", invoice: row.number };
}
