import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";

const SETTINGS_KEY = "alain_profit_settings_v2";
const OLD_SETTINGS_KEY = "alain_profit_settings_v1";
// Stripe's real card cost: 2.9% + AED 1.00 per payment, plus 5% VAT on that fee = 3.045% + AED 1.05.
// Checked against 5 real payments: AED 623.56 paid, fees AED 24.23 (formula gives 24.24).
// Stripe charges the fixed AED 1.05 once per payment, not per spool, so it is shared across the spools in one order.
const defaults = { margin: 30, feePct: 3.045, feeFixed: 1.05, step: 1, includeFee: true, perOrder: 2 };
const fixedPerSpool = ({ feeFixed, perOrder }) => feeFixed / Math.max(1, Number(perOrder) || 1);

function loadSettings() {
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (saved) return { ...defaults, ...JSON.parse(saved) };
    // First time on the new fee: keep the old margin / rounding choices, but use the real fee.
    const old = JSON.parse(window.localStorage.getItem(OLD_SETTINGS_KEY) || "{}");
    return { ...defaults, margin: old.margin ?? defaults.margin, step: old.step ?? defaults.step, includeFee: old.includeFee ?? defaults.includeFee };
  } catch {
    return defaults;
  }
}

// price needed so that profit after fees equals the target margin of the selling price
export function suggestedPrice(cost, settings) {
  const { margin, feePct, step, includeFee } = settings;
  if (!(cost > 0)) return 0;
  const f = includeFee ? feePct / 100 : 0;
  const fixed = includeFee ? fixedPerSpool(settings) : 0;
  const denominator = 1 - f - margin / 100;
  if (denominator <= 0.05) return 0;
  const raw = (cost + fixed) / denominator;
  return Math.ceil(raw / step) * step;
}

const profitOf = (price, cost, settings) =>
  price - cost - (settings.includeFee && price > 0 ? price * (settings.feePct / 100) + fixedPerSpool(settings) : 0);

export default function ProfitPanel({ filaments, onUpdate, showToast }) {
  const [settings, setSettings] = useState(loadSettings);
  const [costDraft, setCostDraft] = useState({});
  const [priceDraft, setPriceDraft] = useState({});
  const [busy, setBusy] = useState(false);

  const change = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* optional */ }
  };

  const types = useMemo(() => {
    const map = new Map();
    for (const entry of filaments) {
      if (entry.stockStatus !== "available" || entry.material === "Payment Test") continue;
      const spools = Math.floor(Number(entry.remainingG || 0) / Number(entry.spoolWeightG || 1000));
      if (spools < 1) continue;
      if (!map.has(entry.material)) map.set(entry.material, { type: entry.material, rows: [], spools: 0, costedSpools: 0, costValue: 0, sellValue: 0 });
      const group = map.get(entry.material);
      group.rows.push(entry);
      group.spools += spools;
      // Spools with no cost yet are left out of the averages, so they can't drag the cost down to AED 0.
      if (Number(entry.purchaseCost || 0) > 0) {
        group.costedSpools += spools;
        group.costValue += spools * Number(entry.purchaseCost);
        group.sellValue += spools * Number(entry.sellingPrice || 0);
      }
    }
    return [...map.values()].sort((a, b) => a.type.localeCompare(b.type)).map((group) => {
      const cost = group.costedSpools ? group.costValue / group.costedSpools : 0;
      const averagePrice = group.costedSpools ? group.sellValue / group.costedSpools : 0;
      // Sell price shown for the type: the real average over every spool, costed or not.
      const price = group.rows.reduce((sum, entry) => sum + Math.floor(Number(entry.remainingG || 0) / Number(entry.spoolWeightG || 1000)) * Number(entry.sellingPrice || 0), 0) / group.spools;
      const profit = profitOf(averagePrice || price, cost, settings);
      return { ...group, cost, price, profit, margin: (averagePrice || price) > 0 ? (profit / (averagePrice || price)) * 100 : 0, suggested: suggestedPrice(cost, settings), stockProfit: profit * group.costedSpools, uncosted: group.spools - group.costedSpools };
    });
  }, [filaments, settings]);

  const totals = useMemo(() => {
    // Every number here covers only spools that have a cost, so the cards always compare like with like.
    const costed = types.filter((group) => group.costedSpools > 0);
    const spools = types.reduce((sum, group) => sum + group.spools, 0);
    const costedSpools = types.reduce((sum, group) => sum + group.costedSpools, 0);
    const cost = types.reduce((sum, group) => sum + group.costValue, 0);
    const sell = types.reduce((sum, group) => sum + group.sellValue, 0);
    const profit = costed.reduce((sum, group) => sum + group.stockProfit, 0);
    return { spools, costedSpools, cost, sell, profit, margin: sell > 0 && costed.length ? (profit / sell) * 100 : 0, missing: types.length - costed.length };
  }, [types]);

  const applyToType = async (group, patch, message) => {
    setBusy(true);
    try {
      for (const entry of group.rows) await onUpdate({ ...entry, ...patch });
      showToast(message);
    } catch {
      showToast("Couldn't update. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveCost = (group) => {
    const value = Number(costDraft[group.type]);
    if (!(value >= 0) || costDraft[group.type] === undefined || costDraft[group.type] === "") return;
    applyToType(group, { purchaseCost: value }, `${group.type}: cost set to ${AED(value)} per spool`).then(() => setCostDraft((d) => ({ ...d, [group.type]: undefined })));
  };
  const saveSellPrice = (group) => {
    const value = Number(priceDraft[group.type]);
    if (!(value > 0) || priceDraft[group.type] === undefined || priceDraft[group.type] === "") return;
    if (!window.confirm(`Set the selling price of every ${group.type} spool to ${AED(value)}?`)) return;
    applyToType(group, { sellingPrice: value }, `${group.type}: price set to ${AED(value)}`).then(() => setPriceDraft((d) => ({ ...d, [group.type]: undefined })));
  };
  const applyPrice = (group) => {
    if (!group.suggested || !window.confirm(`Set the selling price of every ${group.type} spool to ${AED(group.suggested)}?`)) return;
    applyToType(group, { sellingPrice: group.suggested }, `${group.type}: price set to ${AED(group.suggested)}`);
  };

  return (
    <details style={s.box} open>
      <summary style={s.summary}><strong>Profit and resale prices</strong><span style={s.sub}>cost, profit per spool and what to charge</span></summary>

      <div style={s.cards}>
        <Card label="Stock cost" value={totals.costedSpools ? AED(totals.cost) : "set costs"} />
        <Card label="Stock selling value" value={totals.costedSpools ? AED(totals.sell) : "set costs"} />
        <Card label="Expected profit" value={totals.missing === types.length ? "set costs" : AED(totals.profit)} tone="good" />
        <Card label="Average margin" value={totals.missing === types.length ? "-" : `${totals.margin.toFixed(0)}%`} tone="good" />
      </div>
      {totals.costedSpools < totals.spools && <p style={s.note}>The cards count only the {totals.costedSpools} of {totals.spools} spools that have a cost. {totals.missing > 0 ? `${totals.missing} type${totals.missing === 1 ? "" : "s"} still need a cost per spool. ` : ""}Type the cost in the table and press Save.</p>}

      <div style={s.settings}>
        <label style={s.field}>Target margin %<input style={s.input} type="number" min="0" max="90" value={settings.margin} onChange={(e) => change({ margin: Number(e.target.value) || 0 })} /></label>
        <label style={s.field}>Card fee %<input style={s.input} type="number" min="0" step="0.001" value={settings.feePct} onChange={(e) => change({ feePct: Number(e.target.value) || 0 })} /></label>
        <label style={s.field}>Fixed fee AED<input style={s.input} type="number" min="0" step="0.01" value={settings.feeFixed} onChange={(e) => change({ feeFixed: Number(e.target.value) || 0 })} /></label>
        <label style={s.field}>Spools per order<input style={s.input} type="number" min="1" step="0.5" value={settings.perOrder} onChange={(e) => change({ perOrder: Number(e.target.value) || 1 })} /></label>
        <label style={s.field}>Round up to<select style={s.input} value={settings.step} onChange={(e) => change({ step: Number(e.target.value) })}><option value={1}>AED 1</option><option value={5}>AED 5</option><option value={0.5}>AED 0.5</option></select></label>
        <label style={{ ...s.field, flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={settings.includeFee} onChange={(e) => change({ includeFee: e.target.checked })} />Count card fee</label>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>{["Type", "Spools", "Cost / spool", "Sell price", "Profit / spool", "Margin", `Suggested @${settings.margin}%`, "Stock profit"].map((h, i) => <th key={h} style={{ ...s.th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {types.map((group) => {
              const hasCost = group.cost > 0;
              return (
                <tr key={group.type}>
                  <td style={{ ...s.td, fontWeight: 800 }}>{group.type}</td>
                  <td style={s.num}>{group.spools}</td>
                  <td style={s.num}>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input style={{ ...s.input, width: 74 }} type="number" min="0" step="0.01" inputMode="decimal" placeholder={hasCost ? group.cost.toFixed(2) : "cost"} value={costDraft[group.type] ?? ""} onChange={(e) => setCostDraft({ ...costDraft, [group.type]: e.target.value })} />
                      <button style={s.small} disabled={busy || (costDraft[group.type] ?? "") === ""} onClick={() => saveCost(group)}>Save</button>
                    </span>
                    {hasCost && <div style={s.hint}>now {AED(group.cost)}{group.uncosted > 0 ? ` (${group.uncosted} spool${group.uncosted === 1 ? "" : "s"} have no cost)` : ""}</div>}
                  </td>
                  <td style={s.num}>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input style={{ ...s.input, width: 74 }} type="number" min="0" step="0.5" inputMode="decimal" placeholder={group.price.toFixed(2)} value={priceDraft[group.type] ?? ""} onChange={(e) => setPriceDraft({ ...priceDraft, [group.type]: e.target.value })} />
                      <button style={s.small} disabled={busy || (priceDraft[group.type] ?? "") === ""} onClick={() => saveSellPrice(group)}>Save</button>
                    </span>
                    <div style={s.hint}>now {AED(group.price)}</div>
                  </td>
                  <td style={{ ...s.num, color: hasCost ? (group.profit >= 0 ? "#047857" : "#B91C1C") : "#746A59", fontWeight: 800 }}>{hasCost ? AED(group.profit) : "-"}</td>
                  <td style={s.num}>{hasCost ? `${group.margin.toFixed(0)}%` : "-"}</td>
                  <td style={s.num}>
                    {hasCost && group.suggested ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <strong>{AED(group.suggested)}</strong>
                        {Math.abs(group.suggested - group.price) >= 0.01 && <button style={s.small} disabled={busy} onClick={() => applyPrice(group)}>Use</button>}
                      </span>
                    ) : "-"}
                  </td>
                  <td style={{ ...s.num, fontWeight: 800 }}>{hasCost ? AED(group.stockProfit) : "-"}</td>
                </tr>
              );
            })}
            {!types.length && <tr><td style={s.td} colSpan={8}>No spools in stock.</td></tr>}
          </tbody>
        </table>
      </div>
      <p style={s.note}>Profit = sell price - cost{settings.includeFee ? ` - card fee (${settings.feePct}% + AED ${settings.feeFixed} per payment, shared over ${settings.perOrder} spool${Number(settings.perOrder) === 1 ? "" : "s"} per order)` : ""}. The suggested price is the lowest price that still gives your target margin, rounded up. Check your real Stripe fee and set it above.</p>
    </details>
  );
}

function Card({ label, value, tone }) {
  return (
    <div style={s.card}>
      <small style={s.cardLabel}>{label}</small>
      <strong style={{ ...s.cardValue, ...(tone === "good" ? { color: "#047857" } : {}) }}>{value}</strong>
    </div>
  );
}

const s = {
  box: { margin: "0 0 18px", padding: 16, border: "1px solid #E4DFD3", borderRadius: 13, background: "#fff" },
  summary: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer", color: "#16324F", fontSize: 15 },
  sub: { color: "#6B6355", fontSize: 12.5 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, margin: "14px 0" },
  card: { padding: "10px 12px", border: "1px solid #EFEAE0", borderRadius: 10, background: "#FBFAF6" },
  cardLabel: { display: "block", color: "#6B6355", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" },
  cardValue: { display: "block", marginTop: 3, color: "#16324F", fontSize: 17 },
  settings: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "10px 0 14px" },
  field: { display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#6B6355" },
  input: { padding: "7px 9px", border: "1px solid #DCD5C6", borderRadius: 8, fontSize: 13, width: 92, background: "#fff" },
  tableWrap: { overflowX: "auto", border: "1px solid #EFEAE0", borderRadius: 10 },
  table: { width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 13.5 },
  th: { padding: "9px 12px", background: "#F8F5EE", fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "#6B6355", whiteSpace: "nowrap" },
  td: { padding: "9px 12px", borderTop: "1px solid #EFEAE0" },
  num: { padding: "9px 12px", borderTop: "1px solid #EFEAE0", textAlign: "right", whiteSpace: "nowrap" },
  hint: { marginTop: 3, color: "#746A59", fontSize: 11 },
  small: { padding: "6px 10px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 12, cursor: "pointer" },
  note: { margin: "10px 0 0", color: "#6B6355", fontSize: 12.5, lineHeight: 1.5 },
};
