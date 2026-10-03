import crypto from "node:crypto";
import { applyRefund, env, getInvoiceRow, readMeta, saveInvoiceMeta, stripe, supabaseConfig, supabaseFetch, uaeDate } from "./_stripe-shared.js";

// Stripe calls this when a payment link is paid. It marks the matching invoice Paid.
export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!supabaseConfig().serviceKey) return response.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });

  try {
    const raw = await readRawBody(request);
    const posted = typeof raw === "string" && raw ? JSON.parse(raw) : request.body || {};

    // Trust the event only if Stripe signed it, or if Stripe itself confirms it exists.
    let event = null;
    if (typeof raw === "string" && raw && verifySignature(raw, request.headers["stripe-signature"])) event = posted;
    if (!event && posted?.id) event = await stripe(`/events/${posted.id}`);
    if (!event) return response.status(400).json({ error: "Unverified event" });

    if (event.type === "charge.refunded") return response.status(200).json(await applyRefund(event.data.object));

    const paidEvents = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
    if (!paidEvents.includes(event.type)) return response.status(200).json({ ignored: event.type });

    const session = event.data.object;
    if (session.payment_status !== "paid") return response.status(200).json({ waiting: session.payment_status });

    const row = await findInvoice(session);
    if (!row) return response.status(200).json({ ignored: "No matching invoice" });

    const meta = readMeta(row);
    if (meta.status === "Paid") return response.status(200).json({ already: "paid" });

    await saveInvoiceMeta(row, {
      status: "Paid",
      paymentMethod: "Card (Stripe)",
      stripePaymentIntent: session.payment_intent || "",
      paidDate: uaeDate(session.created || event.created),
      paymentReference: `${session.payment_intent || session.id}${Number(session.amount_total) !== Math.round(Number(row.total) * 100) ? ` (paid AED ${(Number(session.amount_total) / 100).toFixed(2)}, check amount)` : ""}`,
      stripePaidAmount: session.amount_total,
    });
    return response.status(200).json({ marked: "Paid", invoice: row.number });
  } catch (error) {
    // 500 makes Stripe retry later (e.g. a brief Supabase hiccup).
    return response.status(500).json({ error: error.message || "Webhook failed" });
  }
}

async function findInvoice(session) {
  const invoiceId = session.metadata?.invoice_id;
  if (invoiceId) {
    const row = await getInvoiceRow(invoiceId);
    if (row) return row;
  }
  if (!session.payment_link) return null;
  const filter = encodeURIComponent(JSON.stringify([{ stripeLinkId: session.payment_link }]));
  const rows = await supabaseFetch(`/rest/v1/invoices?lines=cs.${filter}&select=*`);
  return rows?.[0] || null;
}

function verifySignature(raw, header) {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((part) => part.split("=")));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const signatures = String(header).split(",").filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  return signatures.some((signature) => signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)));
}

async function readRawBody(request) {
  if (typeof request.body === "string") return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString("utf8");
  if (request.body && typeof request.body === "object") return "";
  const chunks = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}
