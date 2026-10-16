import { stripe, supabaseFetch } from "./_stripe-shared.js";
import { savePayout } from "./_payouts.js";

// Admin-only: pulls all Stripe payouts into the ledger (first-time import + safety net).
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

  try {
    let saved = 0;
    let after = "";
    for (let page = 0; page < 10; page += 1) {
      const list = await stripe(`/payouts?limit=100&expand%5B%5D=data.destination${after ? `&starting_after=${after}` : ""}`);
      for (const payout of list.data || []) {
        const result = await savePayout(payout);
        if (result.saved) saved += 1;
      }
      if (!list.has_more || !list.data?.length) break;
      after = list.data[list.data.length - 1].id;
    }
    return response.status(200).json({ saved });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Sync failed" });
  }
}
