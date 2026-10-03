import { applyRefund, getInvoiceRow, readMeta, saveInvoiceMeta, stripe, supabaseConfig, supabaseFetch, uaeDate } from "./_stripe-shared.js";

// POST { invoiceId } with the logged-in admin's Supabase token.
// Returns a Stripe Payment Link for exactly this invoice's total, payable once.
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return response.status(401).json({ error: "Please sign in again." });

  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) return response.status(500).json({ error: "Supabase is not configured on the server." });

  try {
    // Only signed-in admins may create links.
    await supabaseFetch("/auth/v1/user", { token });

    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};

    // "Sync refunds": read recent refund events from Stripe (backup for the webhook).
    if (body.action === "refunds") {
      const events = await stripe("/events?type=charge.refunded&limit=50");
      const results = [];
      for (const event of events.data || []) results.push(await applyRefund(event.data.object, token));
      return response.status(200).json({ changed: results.filter((result) => result.marked).length });
    }

    const invoiceId = String(body.invoiceId || "");
    if (!invoiceId) return response.status(400).json({ error: "Missing invoice." });

    const row = await getInvoiceRow(invoiceId, token);
    if (!row) return response.status(404).json({ error: "Invoice not found." });

    const meta = readMeta(row);
    const status = meta.status || "Unpaid";

    // "Check payment": ask Stripe directly whether this invoice's link was paid (backup for the webhook).
    if (body.action === "check") {
      if (status === "Paid") return response.status(200).json({ paid: true, already: true });
      if (!meta.stripeLinkId) return response.status(200).json({ paid: false, reason: "No Stripe link on this invoice yet." });
      const sessions = await stripe(`/checkout/sessions?payment_link=${encodeURIComponent(meta.stripeLinkId)}&limit=10`);
      const session = (sessions.data || []).find((entry) => entry.payment_status === "paid");
      if (!session) return response.status(200).json({ paid: false, reason: "Stripe has no completed payment for this link yet." });
      await saveInvoiceMeta(row, {
        status: "Paid",
        paymentMethod: "Card (Stripe)",
        stripePaymentIntent: session.payment_intent || "",
        paidDate: uaeDate(session.created),
        paymentReference: session.payment_intent || session.id,
        stripePaidAmount: session.amount_total,
      }, token);
      return response.status(200).json({ paid: true });
    }

    if (status === "Paid") return response.status(409).json({ error: "This invoice is already paid." });
    if (status === "Cancelled") return response.status(409).json({ error: "This invoice is cancelled." });

    const amount = Math.round(Number(row.total) * 100);
    if (!(amount >= 200)) return response.status(400).json({ error: "Stripe needs at least AED 2.00." });

    // Reuse the existing link if the amount hasn't changed and it's still active.
    if (meta.stripeLinkId && meta.stripeLinkUrl && Number(meta.stripeLinkAmount) === amount) {
      const existing = await stripe(`/payment_links/${meta.stripeLinkId}`).catch(() => null);
      if (existing?.active) return response.status(200).json({ url: meta.stripeLinkUrl, reused: true });
    }

    // Amount changed (invoice edited): switch the old link off so nobody pays the wrong amount.
    if (meta.stripeLinkId) {
      await stripe(`/payment_links/${meta.stripeLinkId}`, { method: "POST", params: { active: "false" } }).catch(() => null);
    }

    const ids = { invoice_id: row.id, invoice_number: String(row.number) };
    const price = await stripe("/prices", {
      method: "POST",
      params: {
        currency: "aed",
        unit_amount: amount,
        product_data: { name: `alainprints invoice #${row.number}` },
        metadata: ids,
      },
    });

    const link = await stripe("/payment_links", {
      method: "POST",
      params: {
        line_items: { 0: { price: price.id, quantity: 1 } },
        metadata: ids,
        payment_intent_data: { metadata: ids, description: `alainprints invoice #${row.number}` },
        restrictions: { completed_sessions: { limit: 1 } },
        after_completion: {
          type: "hosted_confirmation",
          hosted_confirmation: { custom_message: `Thank you! Payment for invoice #${row.number} received. alainprints will be in touch.` },
        },
      },
    });

    await saveInvoiceMeta(row, { stripeLinkId: link.id, stripeLinkUrl: link.url, stripeLinkAmount: amount }, token);
    return response.status(200).json({ url: link.url, reused: false });
  } catch (error) {
    const status = error.status === 401 || error.status === 403 ? 401 : 500;
    return response.status(status).json({ error: error.message || "Couldn't create the payment link." });
  }
}
