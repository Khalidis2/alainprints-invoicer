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

    // "Match payments": paid card invoices from before the payment id was saved get it attached,
    // so their real Stripe fee can be read. Only the payment id is added; amounts and status are never changed.
    if (body.action === "backfill") {
      const rows = await supabaseFetch("/rest/v1/invoices?select=*&order=number.desc&limit=500", { token });
      // Invoice numbers the owner says were paid by Stripe link, even if the app never recorded the method.
      const forced = new Set((Array.isArray(body.numbers) ? body.numbers : []).map((n) => String(n).replace(/\D/g, "")).filter(Boolean));
      const candidates = (rows || []).filter((row) => {
        const meta = readMeta(row);
        if (meta.status !== "Paid" || meta.stripePaymentIntent) return false;
        if (forced.has(String(row.number))) return true;
        return !forced.size && (meta.stripeLinkId || /stripe|card/i.test(meta.paymentMethod || "") || /pi_[A-Za-z0-9]+/.test(meta.paymentReference || ""));
      });
      const notPaid = [...forced].filter((n) => !(rows || []).some((row) => String(row.number) === n && readMeta(row).status === "Paid" && !readMeta(row).stripePaymentIntent));
      if (!candidates.length) return response.status(200).json({ checked: 0, matched: 0, unmatched: [], notPaid, details: [] });

      const paidSessions = [];
      let after = "";
      for (let page = 0; page < 3; page += 1) {
        const list = await stripe(`/checkout/sessions?limit=100${after ? `&starting_after=${after}` : ""}`).catch(() => null);
        if (!list?.data?.length) break;
        paidSessions.push(...list.data.filter((entry) => entry.payment_status === "paid" && entry.payment_intent));
        if (!list.has_more) break;
        after = list.data[list.data.length - 1].id;
      }

      // Succeeded AED payments, for matching by exact amount when nothing else links an invoice to Stripe.
      const used = new Set((rows || []).map((row) => readMeta(row).stripePaymentIntent).filter(Boolean));
      const intents = [];
      if (forced.size) {
        let cursor = "";
        for (let page = 0; page < 3; page += 1) {
          const list = await stripe(`/payment_intents?limit=100${cursor ? `&starting_after=${cursor}` : ""}`).catch(() => null);
          if (!list?.data?.length) break;
          intents.push(...list.data.filter((entry) => entry.status === "succeeded" && String(entry.currency).toLowerCase() === "aed"));
          if (!list.has_more) break;
          cursor = list.data[list.data.length - 1].id;
        }
      }

      let matched = 0;
      const unmatched = [];
      const details = [];
      for (const row of candidates) {
        const meta = readMeta(row);
        let intent = "";
        const fromReference = String(meta.paymentReference || "").match(/pi_[A-Za-z0-9]+/);
        if (fromReference) {
          const found = await stripe(`/payment_intents/${fromReference[0]}`).catch(() => null);
          if (found?.status === "succeeded") intent = found.id;
        }
        if (!intent && meta.stripeLinkId) {
          const sessions = await stripe(`/checkout/sessions?payment_link=${encodeURIComponent(meta.stripeLinkId)}&limit=10`).catch(() => null);
          intent = (sessions?.data || []).find((entry) => entry.payment_status === "paid" && entry.payment_intent)?.payment_intent || "";
        }
        if (!intent) {
          intent = paidSessions.find((entry) => entry.metadata?.invoice_id === row.id || entry.metadata?.invoice_number === String(row.number))?.payment_intent || "";
        }
        if (!intent && forced.has(String(row.number))) {
          const cents = Math.round(Number(row.total) * 100);
          const same = intents.filter((entry) => !used.has(entry.id) && Number(entry.amount_received || entry.amount) === cents);
          if (same.length === 1) intent = same[0].id;
          else if (same.length > 1) {
            const when = new Date(meta.paidDate || row.date).getTime();
            const ranked = same.map((entry) => ({ entry, gap: Math.abs(entry.created * 1000 - when) })).sort((a, b) => a.gap - b.gap);
            if (ranked[0].gap < 3 * 86400000 && (ranked.length === 1 || ranked[1].gap - ranked[0].gap > 86400000)) intent = ranked[0].entry.id;
          }
          if (intent) used.add(intent);
        }
        if (!intent) {
          unmatched.push(row.number);
          continue;
        }
        const patch = { stripePaymentIntent: intent };
        if (forced.has(String(row.number)) && !/stripe/i.test(meta.paymentMethod || "")) patch.paymentMethod = "Card (Stripe)";
        await saveInvoiceMeta(row, patch, token);
        details.push({ number: row.number, paymentIntent: intent });
        matched += 1;
      }
      return response.status(200).json({ checked: candidates.length, matched, unmatched, notPaid, details });
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
