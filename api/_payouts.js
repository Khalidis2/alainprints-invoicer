import { env, stripe, supabaseFetch, uaeDate } from "./_stripe-shared.js";

// Saves one Stripe payout into the ledger. Safe to call many times for the same payout.
// Only payouts to the bank ending in PAYOUT_TRACK_LAST4 are saved (if that env var is set).
export async function savePayout(payout) {
  let last4 = payout.destination?.last4 || "";
  if (!last4 && typeof payout.destination === "string") {
    const fresh = await stripe(`/payouts/${payout.id}?expand%5B%5D=destination`).catch(() => null);
    last4 = fresh?.destination?.last4 || "";
  }
  const only = env("PAYOUT_TRACK_LAST4");
  if (only && last4 && last4 !== only) return { skipped: payout.id };

  const status = payout.status === "paid" ? "done"
    : ["failed", "canceled"].includes(payout.status) ? "failed"
    : "in_transit";

  await supabaseFetch("/rest/v1/rpc/upsert_payout", {
    method: "POST",
    body: {
      p_payout_id: payout.id,
      p_amount: Number(payout.amount || 0) / 100,
      p_date: uaeDate(payout.arrival_date || payout.created),
      p_status: status,
      p_last4: last4,
      p_note: last4 ? `Stripe payout to bank •••• ${last4}` : "Stripe payout",
    },
  });
  return { saved: payout.id, status };
}
