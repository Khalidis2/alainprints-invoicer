import { useEffect, useMemo, useState } from "react";
import { fetchStripeFees } from "../lib/storage";

const money = (value, currency = "AED") =>
  `${currency} ${Number(value || 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Loads the real Stripe fee/net for a list of payment ids. Returns { fees, status } where status is loading | ready | error.
export function useStripeFees(paymentIntents) {
  const key = useMemo(() => [...new Set(paymentIntents.filter(Boolean))].sort().join(","), [paymentIntents]);
  const [state, setState] = useState({ fees: {}, status: key ? "loading" : "ready" });
  useEffect(() => {
    if (!key) {
      setState({ fees: {}, status: "ready" });
      return undefined;
    }
    let alive = true;
    setState((current) => ({ ...current, status: "loading" }));
    fetchStripeFees(key.split(","))
      .then((fees) => alive && setState({ fees, status: "ready" }))
      .catch(() => alive && setState({ fees: {}, status: "error" }));
    return () => { alive = false; };
  }, [key]);
  return state;
}

const usable = (fee) => fee && !fee.pending && !fee.error && typeof fee.net === "number";

// One payment: what the customer paid, Stripe's fee, and what you actually receive.
export function FeeLine({ paymentIntent, total }) {
  const ids = useMemo(() => [paymentIntent], [paymentIntent]);
  const { fees, status } = useStripeFees(ids);
  const fee = fees[paymentIntent];

  if (!paymentIntent) return null;
  if (status === "loading") return <div style={s.line}>Checking Stripe fee…</div>;
  if (!usable(fee)) {
    const reason = fee?.pending ? "Stripe has not finished processing this payment yet." : status === "error" || fee?.error ? "Couldn't read the fee from Stripe." : "Fee not available yet.";
    return <div style={{ ...s.line, ...s.muted }}>{reason}</div>;
  }
  const converted = fee.settlementCurrency && fee.settlementCurrency !== fee.currency;
  return (
    <div style={s.box} aria-label="Stripe fee breakdown">
      <div style={s.row}><span>Customer paid</span><b>{money(fee.gross, fee.currency)}</b></div>
      <div style={s.row}><span>Stripe fee</span><b style={s.fee}>− {money(fee.fee, fee.settlementCurrency || fee.currency)}</b></div>
      <div style={{ ...s.row, ...s.net }}><span>You receive</span><b>{money(fee.net, fee.settlementCurrency || fee.currency)}</b></div>
      {converted && <small style={s.muted}>Paid in {fee.currency}, settled in {fee.settlementCurrency}.</small>}
      {fee.refunded > 0 && <small style={s.muted}>Refunded to customer: {money(fee.refunded, fee.currency)}. Stripe does not return its fee on refunds.</small>}
      {Number.isFinite(total) && Math.abs(fee.gross - total) > 0.01 && <small style={s.warn}>Stripe charged {money(fee.gross, fee.currency)}, the order total is {money(total)}.</small>}
    </div>
  );
}

// Totals for many payments: gross, fees and net, using only payments Stripe has confirmed.
export function FeeSummary({ payments, label = "Card payments" }) {
  const ids = useMemo(() => payments.map((payment) => payment.paymentIntent).filter(Boolean), [payments]);
  const { fees, status } = useStripeFees(ids);
  if (ids.length === 0) return null;

  const rows = ids.map((id) => fees[id]).filter(usable);
  const sameCurrency = rows.every((fee) => (fee.settlementCurrency || fee.currency) === (rows[0].settlementCurrency || rows[0].currency));
  const currency = rows[0] ? rows[0].settlementCurrency || rows[0].currency : "AED";
  const gross = rows.reduce((sum, fee) => sum + fee.gross, 0);
  const totalFees = rows.reduce((sum, fee) => sum + fee.fee, 0);
  const net = rows.reduce((sum, fee) => sum + fee.net, 0);

  return (
    <div style={s.summary}>
      <div style={s.summaryHead}><strong>{label}</strong><small style={s.muted}>{status === "loading" ? "Checking Stripe…" : `${rows.length} of ${ids.length} confirmed by Stripe`}</small></div>
      {rows.length > 0 && sameCurrency ? (
        <div style={s.cards}>
          <div style={s.card}><small>Customers paid</small><b>{money(gross, currency)}</b></div>
          <div style={s.card}><small>Stripe fees</small><b style={s.fee}>− {money(totalFees, currency)}</b></div>
          <div style={{ ...s.card, ...s.netCard }}><small>You receive</small><b>{money(net, currency)}</b></div>
        </div>
      ) : status === "error" ? <small style={s.muted}>Couldn't read the fees from Stripe.</small> : null}
    </div>
  );
}

const s = {
  line: { marginTop: 10, color: "#6B6355", fontSize: 12.5 },
  muted: { color: "#8A7F6D", fontSize: 12 },
  warn: { color: "#B45309", fontSize: 12 },
  box: { display: "grid", gap: 4, marginTop: 10, padding: "10px 12px", border: "1px solid #E4DFD3", borderRadius: 10, background: "#FBFAF6", fontSize: 13 },
  row: { display: "flex", justifyContent: "space-between", gap: 10, color: "#6B6355" },
  fee: { color: "#B3451D" },
  net: { marginTop: 2, paddingTop: 6, borderTop: "1px dashed #DCD5C6", color: "#047857", fontSize: 14.5 },
  summary: { display: "grid", gap: 8, margin: "0 0 16px", padding: 14, border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff" },
  summaryHead: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: "#16324F" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 },
  card: { display: "grid", gap: 3, padding: "10px 12px", border: "1px solid #EFEAE0", borderRadius: 10, background: "#FBFAF6", color: "#6B6355", fontSize: 12 },
  netCard: { borderColor: "#A7D7C5", background: "#F0FDF7", color: "#047857" },
};
