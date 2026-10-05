import { stripe } from "./_stripe-shared.js";
import { SITE_URL, cors } from "./_store-shared.js";

// Temporary AED 2 Stripe Checkout to prove card payments work end to end. Delete this file when testing is done.
// It creates no store order and touches no stock; the webhook ignores it (no order or invoice metadata).
export default async function handler(request, response) {
  cors(request, response, "POST, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = await stripe("/checkout/sessions", {
      method: "POST",
      params: {
        mode: "payment",
        line_items: { 0: { quantity: 1, price_data: { currency: "aed", unit_amount: 200, product_data: { name: "Payment test (AED 2)" } } } },
        metadata: { test_payment: "true" },
        success_url: `${SITE_URL}/store/test-payment?result=paid`,
        cancel_url: `${SITE_URL}/store/test-payment?result=cancelled`,
      },
    });
    return response.status(201).json({ url: session.url });
  } catch (error) {
    return response.status(error.status && error.status < 500 ? error.status : 502).json({ error: error.message || "Test payment is unavailable" });
  }
}
