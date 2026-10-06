import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";

const SETTINGS_KEY = "alain_profit_settings_v1";
const defaults = { margin: 30, feePct: 2.9, feeFixed: 1, step: 1, includeFee: true };

function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

// price needed so that profit after fees equals the target margin of the selling price
export function suggestedPrice(cost, { margin, feePct, feeFixed, step, includeFee }) {
  if (!(cost > 0)) return 0;
  const f = includeFee ? feePct / 100 : 0;
  const fixed = includeFee ? feeFixed : 0;
  const denominator = 1 - f - margin / 100;
  if (denominator <= 0.05) return 0;
  const raw = (cost + fixed) / denominator;
  return Math.ceil(raw / step) * step;
}

const profitOf = (price, cost, { feePct, feeFixed, includeFee }) =>
  price - cost - (includeFee && price > 0 ? price * (feePct / 100) + feeFixed : 0);

export default function ProfitPanel({ filaments, onUpdate, showToast }) {
  const [settings, setSettings] = useState(loadSettings);
  const [costDraft, setCostDraft] = useState({});
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
      if (!map.has(entry.material)) map.set(entry.material, { type: entry.material, rows: [], spools: 0, costValue: 0, sellValue: 0 });
      const group = map.get(entry.material);
      group.rows.push(entry);
      group.spools += spools;
      group.costValue += spools * Number(entry.purchaseCost || 0);
      group.sellValue += spools * Number(entry.sellingPrice || 0);
    }
    return [...map.values()].sort((a, b) => a.type.localeCompare(b.type)).map((group) => {
      const cost = group.costValue / group.spools;
      const price = group.sellValue / group.spools;
      const profit = profitOf(price, cost, settings);
      return { ...group, cost, price, profit, margin: price > 0 ? (profit / price) * 100 : 0, suggested: suggestedPrice(cost, settings), stockProfit: profit * group.spools };
    });
  }, [filaments, settings]);

  const totals = useMemo(() => {
    const costed = types.filter((group) => group.cost > 0);
    const spools = types.reduce((sum, group) => sum + group.spools, 0);
    const cost = types.reduce((sum, group) => sum + group.costValue, 0);
    const sell = types.reduce((sum, group) => sum + group.sellValue, 0);
    const profit = costed.reduce((sum, group) => sum + group.stockProfit, 0);
    return { spools, cost, sell, profit, margin: sell > 0 && costed.length ? (profit / costed.reduce((sum, group) => sum + group.sellValue, 0)) * 100 : 0, missing: types.length - costed.length };
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
  const applyPrice = (group) => {
    if (!group.suggested || !window.confirm(`Set the selling price of every ${group.type} spool to ${AED(group.suggested)}?`)) return;
    applyToType(group, { sellingPrice: group.suggested }, `${group.type}: price set to ${AED(group.suggested)}`);
  };

  return (
    <details style={s.box} open>
      <summary style={s.summary}><strong>Profit and resale prices</strong><span style={s.sub}>cost, profit per spool and what to charge</span></summary>

      <div style={s.cards}>
        <Card label="Stock cost" value={AED(totals.cost)} />
        <Card label="Stock selling value" value={AED(totals.sell)} />
        <Card label="Expected profit" value={totals.missing === types.length ? "set costs" : AED(totals.profit)} tone="good" />
        <Card label="Average margin" value={totals.missing === types.length ? "-" : `${totals.margin.toFixed(0)}%`} tone="good" />
      </div>
      {totals.missing > 0 && <p style={s.note}>{totals.missing} type{totals.missing === 1 ? "" : "s"} still need a cost per spool. Type the cost in the table and press Save.</p>}

      <div style={s.settings}>
        <label style={s.field}>Target margin %<input style={s.input} type="number" min="0" max="90" value={settings.margin} onChange={(e) => change({ margin: Number(e.target.value) || 0 })} /></label>
        <label style={s.field}>Card fee %<input style={s.input} type="number" min="0" step="0.1" value={settings.feePct} onChange={(e) => change({ feePct: Number(e.target.value) || 0 })} /></label>
        <label style={s.field}>Fixed fee AED<input style={s.input} type="number" min="0" step="0.1" value={settings.feeFixed} onChange={(e) => change({ feeFixed: Number(e.target.value) || 0 })} /></label>
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
                    {hasCost && <div style={s.hint}>now {AED(group.cost)}</div>}
                  </td>
                  <td style={s.num}>{AED(group.price)}</td>
                  <td style={{ ...s.num, color: hasCost ? (group.profit >= 0 ? "#047857" : "#B91C1C") : "#8A7F6D", fontWeight: 800 }}>{hasCost ? AED(group.profit) : "-"}</td>
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
      <p style={s.note}>Profit = sell price - cost{settings.includeFee ? ` - card fee (${settings.feePct}% + AED ${settings.feeFixed})` : ""}. The suggested price is the lowest price that still gives your target margin, rounded up. Check your real Stripe fee and set it above.</p>
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
  hint: { marginTop: 3, color: "#8A7F6D", fontSize: 11 },
  small: { padding: "6px 10px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 12, cursor: "pointer" },
  note: { margin: "10px 0 0", color: "#6B6355", fontSize: 12.5, lineHeight: 1.5 },
};
