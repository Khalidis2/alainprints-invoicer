import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";

export default function FilamentInventory({ filaments, onUpdate, onReceive, showToast }) {
  const [status, setStatus] = useState("available");
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("all");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const materialTypes = useMemo(() => [...new Set(
    filaments
      .filter((entry) => entry.stockStatus === status)
      .map((entry) => entry.material)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b)), [filaments, status]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return filaments.filter((entry) => {
      const matchesStatus = entry.stockStatus === status;
      const matchesMaterial = material === "all" || entry.material === material;
      const text = `${entry.sku} ${entry.brand} ${entry.material} ${entry.color} ${entry.location}`.toLocaleLowerCase();
      return matchesStatus && matchesMaterial && (!needle || text.includes(needle));
    });
  }, [filaments, material, query, status]);

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
    availableSpools: filaments.filter((entry) => entry.stockStatus === "available").reduce((sum, entry) => sum + entry.remainingG / entry.spoolWeightG, 0),
    incomingSpools: filaments.filter((entry) => entry.stockStatus === "incoming").reduce((sum, entry) => sum + entry.quantitySpools, 0),
    availableKg: filaments.filter((entry) => entry.stockStatus === "available").reduce((sum, entry) => sum + entry.remainingG, 0) / 1000,
  }), [filaments]);

  const save = async () => {
    if (!editing?.material.trim() || !editing?.color.trim()) return;
    setBusy(true);
    try {
      await onUpdate(editing);
      setEditing(null);
      showToast("Filament updated");
    } catch {
      showToast("Couldn't update filament");
    } finally {
      setBusy(false);
    }
  };

  const adjustStock = async (entry, deltaSpools) => {
    const spoolWeightG = Number(entry.spoolWeightG || 1000);
    const remainingG = Math.max(0, Number(entry.remainingG || 0) + deltaSpools * spoolWeightG);
    setBusy(true);
    try {
      await onUpdate({
        ...entry,
        remainingG,
        quantitySpools: remainingG / spoolWeightG,
      });
      showToast(deltaSpools < 0 ? "Removed 1 spool" : "Added 1 spool");
    } catch {
      showToast("Couldn't update filament stock");
    } finally {
      setBusy(false);
    }
  };

  const updateEditingSpools = (value) => {
    const quantitySpools = Math.max(0, Number(value) || 0);
    const spoolWeightG = Number(editing.spoolWeightG || 1000);
    setEditing({
      ...editing,
      quantitySpools,
      remainingG: editing.stockStatus === "available" ? quantitySpools * spoolWeightG : editing.remainingG,
    });
  };

  const updateEditingGrams = (value) => {
    const remainingG = Math.max(0, Number(value) || 0);
    const spoolWeightG = Number(editing.spoolWeightG || 1000);
    setEditing({
      ...editing,
      remainingG,
      quantitySpools: remainingG / spoolWeightG,
    });
  };

  const receive = async (entry) => {
    if (!window.confirm(`Mark ${entry.quantitySpools} × ${entry.material} ${entry.color} as received?`)) return;
    setBusy(true);
    try {
      await onReceive(entry);
      showToast("Filament moved to available stock");
    } catch {
      showToast("Couldn't receive filament");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 style={s.title}>Filament inventory</h2>
      <div className="filament-summary" style={s.summary}>
        <Summary label="Available" value={`${totals.availableSpools.toFixed(1)} spools`} />
        <Summary label="Available weight" value={`${totals.availableKg.toFixed(1)} kg`} />
        <Summary label="Incoming" value={`${totals.incomingSpools} spools`} />
      </div>

      <div className="filament-toolbar" style={s.toolbar}>
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(status === "available" ? s.tabActive : {}) }} onClick={() => setStatus("available")}>Available</button>
          <button style={{ ...s.tab, ...(status === "incoming" ? s.tabActive : {}) }} onClick={() => setStatus("incoming")}>Incoming</button>
        </div>
        <select style={s.typeFilter} value={material} onChange={(event) => setMaterial(event.target.value)} aria-label="Filter by filament type">
          <option value="all">All types</option>
          {materialTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input style={s.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search colour, location or SKU" />
      </div>

      <div style={s.groups}>
        {groupedRows.map(([type, entries]) => (
          <section key={type} style={s.group}>
            <div style={s.groupHead}>
              <h3 style={s.groupTitle}>{type}</h3>
              <span style={s.groupCount}>{entries.length} {entries.length === 1 ? "colour" : "colours"}</span>
            </div>
            <div className="filament-grid" style={s.grid}>
              {entries.map((entry) => {
          const low = entry.stockStatus === "available" && entry.remainingG < entry.spoolWeightG;
          const spoolEquivalent = entry.remainingG / Number(entry.spoolWeightG || 1000);
          return (
            <article key={entry.id} style={{ ...s.card, ...(low ? s.lowCard : {}) }}>
              <div style={s.cardHead}>
                <div>
                  <div style={s.material}>{entry.material}</div>
                  <div style={s.color}>{entry.color}</div>
                </div>
                <span style={entry.stockStatus === "available" ? s.available : s.incoming}>{entry.stockStatus}</span>
              </div>
              <div style={s.meta}>{entry.brand}{entry.sku ? ` · ${entry.sku}` : ""}</div>
              {entry.location && <div style={s.location}>📍 {entry.location}</div>}
              {entry.stockStatus === "available" ? (
                <>
                  <div style={s.stock}>{(entry.remainingG / 1000).toFixed(2)} kg remaining</div>
                  <div style={s.spoolCount}>{spoolEquivalent.toFixed(1)} spool equivalent</div>
                  <div style={s.stockActions}>
                    <button style={s.minus} disabled={busy || entry.remainingG <= 0} onClick={() => adjustStock(entry, -1)}>− 1 spool</button>
                    <button style={s.plus} disabled={busy} onClick={() => adjustStock(entry, 1)}>+ 1 spool</button>
                  </div>
                </>
              ) : (
                <div style={s.stock}>{entry.quantitySpools} × 1 kg ordered</div>
              )}
              <div style={s.price}>Sell {AED(entry.sellingPrice)} · Cost {entry.purchaseCost > 0 ? AED(entry.purchaseCost) : "not set"}</div>
              <div style={s.actions}>
                <button style={s.edit} onClick={() => setEditing({ ...entry })}>Edit details</button>
                {entry.stockStatus === "incoming" && <button style={s.receive} disabled={busy} onClick={() => receive(entry)}>Mark received</button>}
              </div>
            </article>
          );
              })}
            </div>
          </section>
        ))}
      </div>

      {rows.length === 0 && <div style={s.empty}>No filament matches this view.</div>}

      {editing && (
        <div style={s.overlay} onClick={() => !busy && setEditing(null)}>
          <div className="filament-modal" style={s.modal} onClick={(event) => event.stopPropagation()}>
            <h3 style={s.modalTitle}>Edit filament</h3>
            <div className="two-column-fields" style={s.formGrid}>
              <Field label="Brand" value={editing.brand} onChange={(value) => setEditing({ ...editing, brand: value })} />
              <Field label="SKU" value={editing.sku} onChange={(value) => setEditing({ ...editing, sku: value })} />
              <Field label="Material" value={editing.material} onChange={(value) => setEditing({ ...editing, material: value })} />
              <Field label="Colour" value={editing.color} onChange={(value) => setEditing({ ...editing, color: value })} />
              <Field label={editing.stockStatus === "available" ? "Stock (spool equivalent)" : "Spools ordered"} type="number" min="0" step="0.1" value={editing.quantitySpools} onChange={updateEditingSpools} />
              <Field label="Remaining grams" type="number" min="0" step="1" value={editing.remainingG} onChange={updateEditingGrams} />
              <Field label="Cost per spool" type="number" min="0" step="0.01" value={editing.purchaseCost} onChange={(value) => setEditing({ ...editing, purchaseCost: Number(value) })} />
              <Field label="Selling price" type="number" min="0" step="0.01" value={editing.sellingPrice} onChange={(value) => setEditing({ ...editing, sellingPrice: Number(value) })} />
              <Field label="Location" value={editing.location} onChange={(value) => setEditing({ ...editing, location: value })} />
              <Field label="Expected date" type="date" value={editing.expectedDate} onChange={(value) => setEditing({ ...editing, expectedDate: value })} />
            </div>
            <label style={s.label}>Notes</label>
            <textarea style={{ ...s.input, minHeight: 70 }} value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} />
            <div className="modal-actions" style={s.modalActions}>
              <button style={s.cancel} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button style={s.save} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Summary({ label, value }) {
  return <div style={s.summaryCard}><span style={s.summaryLabel}>{label}</span><strong style={s.summaryValue}>{value}</strong></div>;
}

function Field({ label, value, onChange, type = "text", min, step }) {
  return <label style={s.label}>{label}<input style={s.input} type={type} min={min} step={step} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

const s = {
  title: { margin: 0, fontSize: 24 },
  summary: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "18px 0" },
  summaryCard: { display: "grid", gap: 5, padding: 14, border: "1px solid #E4DFD3", borderRadius: 10, background: "#fff" },
  summaryLabel: { color: "#8A7F6D", fontSize: 11, fontWeight: 700, textTransform: "uppercase" },
  summaryValue: { color: "#16324F", fontSize: 19 },
  toolbar: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 14 },
  tabs: { display: "flex", gap: 6 },
  tab: { padding: "9px 13px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#6B6355", fontWeight: 700, cursor: "pointer" },
  tabActive: { borderColor: "#E8792D", background: "#FFF5ED", color: "#B45309" },
  typeFilter: { minWidth: 180, padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#1B2A3D", fontWeight: 700 },
  search: { flex: 1, maxWidth: 380, padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 8 },
  groups: { display: "grid", gap: 28 },
  group: { display: "grid", gap: 10 },
  groupHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingBottom: 8, borderBottom: "2px solid #16324F" },
  groupTitle: { margin: 0, color: "#16324F", fontSize: 20 },
  groupCount: { color: "#8A7F6D", fontSize: 12, fontWeight: 700 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 },
  card: { padding: 14, border: "1px solid #E4DFD3", borderRadius: 11, background: "#fff" },
  lowCard: { borderColor: "#F59E0B", background: "#FFFBEB" },
  cardHead: { display: "flex", justifyContent: "space-between", gap: 10 },
  material: { fontWeight: 800, fontSize: 14 },
  color: { marginTop: 3, fontSize: 16, color: "#16324F" },
  meta: { marginTop: 10, color: "#8A7F6D", fontSize: 11.5 },
  location: { marginTop: 6, color: "#6B6355", fontSize: 12, fontWeight: 650 },
  stock: { marginTop: 12, fontWeight: 850, color: "#16324F" },
  spoolCount: { marginTop: 3, color: "#6B6355", fontSize: 11.5 },
  stockActions: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 10 },
  minus: { padding: "9px 8px", border: "1px solid #F2B8A2", borderRadius: 7, background: "#FFF7F3", color: "#B3451D", fontWeight: 800, cursor: "pointer" },
  plus: { padding: "9px 8px", border: "1px solid #A7D7C5", borderRadius: 7, background: "#F0FDF7", color: "#047857", fontWeight: 800, cursor: "pointer" },
  price: { marginTop: 10, color: "#6B6355", fontSize: 11.5 },
  available: { alignSelf: "start", padding: "4px 7px", borderRadius: 20, background: "#ECFDF5", color: "#047857", fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  incoming: { alignSelf: "start", padding: "4px 7px", borderRadius: 20, background: "#EFF6FF", color: "#1D4ED8", fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 12 },
  edit: { padding: "7px 10px", border: "1px solid #DCD5C6", borderRadius: 7, background: "#fff", color: "#2E7D8C", fontWeight: 700, cursor: "pointer" },
  receive: { padding: "7px 10px", border: "none", borderRadius: 7, background: "#047857", color: "#fff", fontWeight: 800, cursor: "pointer" },
  empty: { padding: 30, textAlign: "center", color: "#8A7F6D" },
  overlay: { position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 10, background: "rgba(15,23,42,.52)" },
  modal: { width: "100%", maxWidth: 620, maxHeight: "calc(100dvh - 20px)", overflowY: "auto", padding: 22, borderRadius: 14, background: "#fff" },
  modalTitle: { margin: "0 0 14px" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  label: { display: "grid", gap: 5, marginTop: 8, color: "#6B6355", fontSize: 11.5, fontWeight: 700 },
  input: { width: "100%", padding: "9px 10px", border: "1px solid #DCD5C6", borderRadius: 8 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  cancel: { padding: "9px 14px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", fontWeight: 700 },
  save: { padding: "9px 14px", border: "none", borderRadius: 8, background: "#16324F", color: "#fff", fontWeight: 800 },
};
