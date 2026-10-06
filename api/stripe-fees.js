import { stripe, supabaseFetch } from "./_stripe-shared.js";

// Admin-only: the REAL Stripe fee and net amount for card payments, read from Stripe's balance transaction.
// POST { paymentIntents: ["pi_..."] } with the signed-in admin's token.
// Nothing is estimated here: Stripe returns the exact fee (including any tax on fees) and the net amount.
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    await supabaseFetch("/auth/v1/user", { token });
  } catch {
    return response.status(401).json({ error: "Please sign in again." });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const ids = [...new Set((Array.isArray(body.paymentIntents) ? body.paymentIntents : []).map(String))].filter((id) => /^pi_[A-Za-z0-9]+$/.test(id)).slice(0, 40);
  const fees = {};

  await Promise.all(ids.map(async (id) => {
    try {
      const intent = await stripe(`/payment_intents/${id}?expand%5B%5D=latest_charge.balance_transaction`);
      const charge = intent.latest_charge;
      const transaction = charge && typeof charge === "object" ? charge.balance_transaction : null;
      if (!transaction || typeof transaction !== "object") {
        fees[id] = { pending: true };
        return;
      }
      const cents = (value) => Number(value || 0) / 100;
      fees[id] = {
        gross: cents(charge.amount),
        currency: String(charge.currency || "").toUpperCase(),
        fee: cents(transaction.fee),
        net: cents(transaction.net),
        settlementGross: cents(transaction.amount),
        settlementCurrency: String(transaction.currency || "").toUpperCase(),
        exchangeRate: transaction.exchange_rate || null,
        refunded: cents(charge.amount_refunded),
        details: (transaction.fee_details || []).map((detail) => ({ type: detail.type, amount: cents(detail.amount), description: detail.description || "" })),
      };
    } catch (error) {
      fees[id] = { error: error.message || "Stripe lookup failed" };
    }
  }));

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ fees });
}
