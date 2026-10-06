import { useEffect, useMemo, useState } from "react";
import { AED } from "../lib/helpers";
import StockList from "./StockList";
import ProfitPanel from "./ProfitPanel";
import { AddFilamentModal, EditFilamentModal } from "./StockEditor";

const spoolsOf = (entry) => entry.remainingG / Number(entry.spoolWeightG || 1000);
const fmt = (value) => (Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1));

export default function FilamentInventory({ filaments, onUpdate, onReceive, onAdd, onArchive, onRestore, loadRemoved, showToast }) {
  const [status, setStatus] = useState("available");
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("all");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState([]);
  const [removedTick, setRemovedTick] = useState(0);

  useEffect(() => {
    if (status !== "removed") return;
    loadRemoved().then(setRemoved).catch(() => showToast("Couldn't load removed filament"));
  }, [status, removedTick, filaments, loadRemoved, showToast]);

  const source = status === "removed" ? removed : filaments.filter((entry) => entry.stockStatus === status);

  const materialTypes = useMemo(() => [...new Set(source.map((entry) => entry.material).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [source]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return source.filter((entry) => {
      const text = `${entry.sku} ${entry.brand} ${entry.material} ${entry.color} ${entry.location}`.toLocaleLowerCase();
      return (material === "all" || entry.material === material) && (!needle || text.includes(needle));
    });
  }, [source, material, query]);

  const groupedRows = useMemo(() => {
    const groups = new Map();
    rows.forEach((entry) => {
      const type = entry.material || "Other";
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(entry);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const totals = useMemo(() => ({
    availableSpools: filaments.filter((entry) => entry.stockStatus === "available").reduce((sum, entry) => sum + spoolsOf(entry), 0),
    incomingSpools: filaments.filter((entry) => entry.stockStatus === "incoming").reduce((sum, entry) => sum + entry.quantitySpools, 0),
    availableKg: filaments.filter((entry) => entry.stockStatus === "available").reduce((sum, entry) => sum + entry.remainingG, 0) / 1000,
  }), [filaments]);

  const adjustStock = async (entry, deltaSpools) => {
    const weight = Number(entry.spoolWeightG || 1000);
    const remainingG = Math.max(0, Number(entry.remainingG || 0) + deltaSpools * weight);
    setBusy(true);
    try {
      await onUpdate({ ...entry, remainingG, quantitySpools: remainingG / weight });
      showToast(`${entry.color}: ${fmt(remainingG / weight)} in stock`);
    } catch {
      showToast("Couldn't change the stock");
    } finally {
      setBusy(false);
    }
  };

  const receive = async (entry) => {
    if (!window.confirm(`Mark ${entry.quantitySpools} × ${entry.material} ${entry.color} as received?`)) return;
    setBusy(true);
    try {
      await onReceive(entry);
      showToast("Moved to stock");
    } catch {
      showToast("Couldn't receive it");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (entry) => {
    setBusy(true);
    try {
      await onRestore(entry.id);
      setRemovedTick((tick) => tick + 1);
      showToast(`${entry.color} restored with 0 spools. Open In stock and press + to add spools.`);
    } catch {
      showToast("Couldn't restore it");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div style={s.titleRow}>
        <h2 style={s.title}>Filament stock</h2>
        <button type="button" style={s.addBtn} onClick={() => setAdding(true)}>＋ Add filament</button>
      </div>
      <div className="filament-summary" style={s.summary}>
        <Summary label="In stock" value={`${fmt(totals.availableSpools)} spools`} />
        <Summary label="Weight" value={`${totals.availableKg.toFixed(1)} kg`} />
        <Summary label="On order" value={`${fmt(totals.incomingSpools)} spools`} />
      </div>

      <StockList filaments={filaments} showToast={showToast} />
      <ProfitPanel filaments={filaments} onUpdate={onUpdate} showToast={showToast} />

      <div className="filament-toolbar" style={s.toolbar}>
        <div style={s.tabs}>
          {[["available", "In stock"], ["incoming", "On order"], ["removed", "Removed"]].map(([key, label]) => (
            <button key={key} style={{ ...s.tab, ...(status === key ? s.tabActive : {}) }} onClick={() => { setStatus(key); setMaterial("all"); }}>{label}</button>
          ))}
        </div>
        <select style={s.typeFilter} value={material} onChange={(event) => setMaterial(event.target.value)} aria-label="Filter by filament type">
          <option value="all">All types</option>
          {materialTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input style={s.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search colour or type" />
      </div>

      {status === "removed" && <p style={s.note}>Removed colours are hidden from your stock and the shop. Nothing is deleted. Press Restore to bring one back.</p>}

      <div style={s.groups}>
        {groupedRows.map(([type, entries]) => (
          <section key={type} style={s.group}>
            <div style={s.groupHead}>
              <h3 style={s.groupTitle}>{type}</h3>
              <span style={s.groupCount}>{entries.length} {entries.length === 1 ? "colour" : "colours"}</span>
            </div>
            <div className="filament-grid" style={s.grid}>
              {entries.map((entry) => {
                const count = spoolsOf(entry);
                const low = entry.stockStatus === "available" && count < 1;
                return (
                  <article key={entry.id} style={{ ...s.card, ...(low ? s.lowCard : {}), ...(status === "removed" ? s.removedCard : {}) }}>
                    <div style={s.cardHead}>
                      <div style={s.color}>{entry.color}</div>
                      {status === "available" && <span style={low ? s.lowPill : s.okPill}>{low ? "Low" : "OK"}</span>}
                    </div>
                    {status === "available" && (
                      <>
                        <div style={s.bigCount}>{fmt(count)} <span style={s.unit}>{count === 1 ? "spool" : "spools"}</span></div>
                        <div style={s.stockActions}>
                          <button style={s.minus} disabled={busy || entry.remainingG <= 0} onClick={() => adjustStock(entry, -1)} aria-label={`Remove one ${entry.color} spool`}>− 1</button>
                          <button style={s.plus} disabled={busy} onClick={() => adjustStock(entry, 1)} aria-label={`Add one ${entry.color} spool`}>+ 1</button>
                        </div>
                      </>
                    )}
                    {status === "incoming" && <div style={s.bigCount}>{fmt(entry.quantitySpools)} <span style={s.unit}>on order</span></div>}
                    {status === "removed" && <div style={s.unitLine}>Removed</div>}
                    <div style={s.price}>Sell {AED(entry.sellingPrice)} · Cost {entry.purchaseCost > 0 ? AED(entry.purchaseCost) : "not set"}</div>
                    <div style={s.actions}>
                      {status === "removed" ? (
                        <button style={s.receive} disabled={busy} onClick={() => restore(entry)}>Restore</button>
                      ) : (
                        <>
                          {status === "incoming" && <button style={s.receive} disabled={busy} onClick={() => receive(entry)}>Mark received</button>}
                          <button style={s.edit} onClick={() => setEditing({ ...entry })}>Edit</button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {rows.length === 0 && (
        <div style={s.empty}>
          {status === "removed" ? "Nothing has been removed." : "No filament matches this view."}
          {status !== "removed" && <div><button type="button" style={{ ...s.addBtn, marginTop: 12 }} onClick={() => setAdding(true)}>＋ Add filament</button></div>}
        </div>
      )}

      {adding && <AddFilamentModal filaments={filaments} onSave={onAdd} onClose={() => setAdding(false)} showToast={showToast} />}
      {editing && <EditFilamentModal entry={editing} onSave={onUpdate} onRemove={async (id) => { await onArchive(id); setRemovedTick((tick) => tick + 1); }} onClose={() => setEditing(null)} showToast={showToast} />}
    </section>
  );
}

function Summary({ label, value }) {
  return <div style={s.summaryCard}><span style={s.summaryLabel}>{label}</span><strong style={s.summaryValue}>{value}</strong></div>;
}

const s = {
  titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 24 },
  addBtn: { minHeight: 46, padding: "0 20px", border: 0, borderRadius: 12, background: "#047857", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  summary: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "18px 0" },
  summaryCard: { display: "grid", gap: 5, padding: 14, border: "1px solid #E4DFD3", borderRadius: 10, background: "#fff" },
  summaryLabel: { color: "#8A7F6D", fontSize: 11, fontWeight: 700, textTransform: "uppercase" },
  summaryValue: { color: "#16324F", fontSize: 19 },
  toolbar: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginBottom: 14 },
  tabs: { display: "flex", gap: 6 },
  tab: { minHeight: 44, padding: "0 14px", border: "1px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#6B6355", fontWeight: 800, cursor: "pointer" },
  tabActive: { borderColor: "#E8792D", background: "#FFF5ED", color: "#B45309" },
  typeFilter: { minWidth: 160, minHeight: 44, padding: "0 12px", border: "1px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#1B2A3D", fontWeight: 700 },
  search: { flex: 1, minWidth: 160, maxWidth: 380, minHeight: 44, padding: "0 12px", border: "1px solid #DCD5C6", borderRadius: 10, fontSize: 16 },
  note: { margin: "0 0 14px", color: "#6B6355", fontSize: 13 },
  groups: { display: "grid", gap: 28 },
  group: { display: "grid", gap: 10 },
  groupHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingBottom: 8, borderBottom: "2px solid #16324F" },
  groupTitle: { margin: 0, color: "#16324F", fontSize: 20 },
  groupCount: { color: "#8A7F6D", fontSize: 12, fontWeight: 700 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 },
  card: { display: "grid", gap: 8, padding: 14, border: "1px solid #E4DFD3", borderRadius: 14, background: "#fff" },
  lowCard: { borderColor: "#F59E0B", background: "#FFFBEB" },
  removedCard: { opacity: 0.8, background: "#FAF8F3" },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 },
  color: { fontSize: 17, fontWeight: 800, color: "#16324F", lineHeight: 1.25 },
  okPill: { padding: "3px 8px", borderRadius: 20, background: "#ECFDF5", color: "#047857", fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  lowPill: { padding: "3px 8px", borderRadius: 20, background: "#FEF3C7", color: "#B45309", fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  bigCount: { fontSize: 34, fontWeight: 900, color: "#16324F", letterSpacing: "-.02em", lineHeight: 1 },
  unit: { fontSize: 14, fontWeight: 700, color: "#6B6355", letterSpacing: 0 },
  unitLine: { color: "#8A7F6D", fontWeight: 700 },
  stockActions: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  minus: { minHeight: 46, border: "1px solid #F2B8A2", borderRadius: 10, background: "#FFF7F3", color: "#B3451D", fontWeight: 900, fontSize: 18, cursor: "pointer" },
  plus: { minHeight: 46, border: "1px solid #A7D7C5", borderRadius: 10, background: "#F0FDF7", color: "#047857", fontWeight: 900, fontSize: 18, cursor: "pointer" },
  price: { color: "#6B6355", fontSize: 12.5 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  edit: { minHeight: 40, padding: "0 16px", border: "1px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#2E7D8C", fontWeight: 800, cursor: "pointer" },
  receive: { minHeight: 40, padding: "0 14px", border: 0, borderRadius: 10, background: "#047857", color: "#fff", fontWeight: 800, cursor: "pointer" },
  empty: { padding: 30, textAlign: "center", color: "#8A7F6D" },
};
