import { useMemo } from "react";
import { AED } from "../lib/helpers";

const SITE = "printtools3d.com/store";
const BRAND = "Alain Prints";

// Spools you can sell today, grouped by type: one row per type + colour.
function buildGroups(filaments) {
  const rows = new Map();
  for (const entry of filaments) {
    if (entry.stockStatus !== "available" || entry.material === "Payment Test") continue;
    const spools = Math.floor(Number(entry.remainingG || 0) / Number(entry.spoolWeightG || 1000));
    if (spools < 1) continue;
    const key = `${entry.material}|${String(entry.color).trim().toLowerCase()}`;
    const price = Number(entry.sellingPrice || 0);
    const current = rows.get(key);
    if (current) {
      current.spools += spools;
      current.price = current.price || price;
    } else {
      rows.set(key, { type: entry.material, color: String(entry.color).trim(), spools, price });
    }
  }
  const groups = new Map();
  for (const row of rows.values()) {
    if (!groups.has(row.type)) groups.set(row.type, []);
    groups.get(row.type).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => ({ type, rows: list.sort((a, b) => a.color.localeCompare(b.color)) }));
}

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
const samePrice = (rows) => rows.every((row) => row.price === rows[0].price);

function whatsappText(groups) {
  const lines = [`*Available filament - ${BRAND}*`, `_Updated ${today()} · 1 kg spools, 1.75 mm_`, ""];
  for (const group of groups) {
    const uniform = samePrice(group.rows);
    lines.push(`*${group.type}*${uniform ? ` - AED ${group.rows[0].price}` : ""}`);
    for (const row of group.rows) lines.push(`• ${row.color} - ${row.spools} ${row.spools === 1 ? "spool" : "spools"}${uniform ? "" : ` - AED ${row.price}`}`);
    lines.push("");
  }
  lines.push(`Order online: ${SITE}`);
  return lines.join("\n");
}

function csvText(groups) {
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = [["Type", "Colour", "Spools available", "Price per spool (AED)"].map(cell).join(",")];
  for (const group of groups) for (const row of group.rows) lines.push([group.type, row.color, row.spools, row.price].map(cell).join(","));
  return `﻿${lines.join("\r\n")}`;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function printHtml(groups, totalSpools) {
  const body = groups.map((group) => `
    <tr class="type"><td colspan="3">${escapeHtml(group.type)}</td></tr>
    ${group.rows.map((row) => `<tr><td>${escapeHtml(row.color)}</td><td class="n">${row.spools}</td><td class="n">AED ${row.price}</td></tr>`).join("")}`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Available filament - ${BRAND}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px}
    h1{margin:0 0 4px;font-size:22px} p{margin:0 0 16px;color:#555;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th{text-align:left;padding:8px;border-bottom:2px solid #111;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
    td{padding:7px 8px;border-bottom:1px solid #ddd} .n{text-align:right;white-space:nowrap}
    th.n{text-align:right} tr.type td{background:#f1efe9;font-weight:700;border-bottom:1px solid #bbb;padding-top:9px}
    tr{break-inside:avoid} footer{margin-top:18px;font-size:12px;color:#555}
  </style></head><body>
  <h1>Available filament · ${BRAND}</h1>
  <p>Updated ${today()} · ${totalSpools} spools in stock · 1 kg spools, 1.75 mm</p>
  <table><thead><tr><th>Colour</th><th class="n">Spools</th><th class="n">Price</th></tr></thead><tbody>${body}</tbody></table>
  <footer>Order online: ${SITE} · WhatsApp +971 56 776 6717</footer>
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`;
}

export default function StockList({ filaments, showToast }) {
  const groups = useMemo(() => buildGroups(filaments), [filaments]);
  const totalSpools = groups.reduce((sum, group) => sum + group.rows.reduce((inner, row) => inner + row.spools, 0), 0);
  const colourCount = groups.reduce((sum, group) => sum + group.rows.length, 0);

  const copy = async () => {
    const text = whatsappText(groups);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    showToast("Stock list copied. Paste it into WhatsApp.");
  };
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText(groups))}`, "_blank", "noopener");
  const download = () => {
    const blob = new Blob([csvText(groups)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `available-filament-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  };
  const print = () => {
    const win = window.open("", "_blank");
    if (!win) return showToast("Allow pop-ups to print the list");
    win.document.write(printHtml(groups, totalSpools));
    win.document.close();
  };

  return (
    <details style={s.box} open>
      <summary style={s.summary}>
        <strong>Customer stock list</strong>
        <span style={s.count}>{colourCount} colours · {totalSpools} spools</span>
      </summary>
      <div style={s.actions}>
        <button style={s.primary} onClick={copy} disabled={!groups.length}>Copy for WhatsApp</button>
        <button style={s.btn} onClick={whatsapp} disabled={!groups.length}>Send on WhatsApp</button>
        <button style={s.btn} onClick={download} disabled={!groups.length}>Download Excel/CSV</button>
        <button style={s.btn} onClick={print} disabled={!groups.length}>Print / Save PDF</button>
      </div>
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Colour</th><th style={{ ...s.th, textAlign: "right" }}>Spools</th><th style={{ ...s.th, textAlign: "right" }}>Price</th></tr></thead>
          <tbody>
            {groups.map((group) => (
              <FragmentRows key={group.type} group={group} />
            ))}
            {!groups.length && <tr><td style={s.td} colSpan={3}>No spools in stock.</td></tr>}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function FragmentRows({ group }) {
  return (
    <>
      <tr><td colSpan={3} style={s.type}>{group.type}</td></tr>
      {group.rows.map((row) => (
        <tr key={row.color}>
          <td style={s.td}>{row.color}</td>
          <td style={{ ...s.td, textAlign: "right", fontWeight: 800 }}>{row.spools}</td>
          <td style={{ ...s.td, textAlign: "right" }}>{AED(row.price)}</td>
        </tr>
      ))}
    </>
  );
}

const s = {
  box: { margin: "0 0 18px", padding: 16, border: "1px solid #E4DFD3", borderRadius: 13, background: "#fff" },
  summary: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer", color: "#16324F", fontSize: 15 },
  count: { color: "#6B6355", fontSize: 12.5 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" },
  primary: { padding: "10px 14px", border: 0, borderRadius: 9, background: "#047857", color: "#fff", fontWeight: 800, cursor: "pointer" },
  btn: { padding: "10px 14px", border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff", color: "#16324F", fontWeight: 700, cursor: "pointer" },
  tableWrap: { maxHeight: 360, overflow: "auto", border: "1px solid #EFEAE0", borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  th: { position: "sticky", top: 0, padding: "9px 12px", background: "#F8F5EE", textAlign: "left", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6355" },
  type: { padding: "9px 12px", background: "#F1EFE9", color: "#16324F", fontWeight: 800 },
  td: { padding: "8px 12px", borderTop: "1px solid #EFEAE0" },
};
