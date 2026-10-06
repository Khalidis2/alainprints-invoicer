import { useMemo, useState } from "react";

const COMMON_TYPES = ["PLA+", "PLA Basic", "PLA HS", "PLA Matte", "PETG", "PETG Matte", "Silk Tricolor", "PLA Marble"];

// Most common selling price already used for a type, so a new colour starts with the right price.
export function usualPrice(filaments, material) {
  const counts = new Map();
  for (const entry of filaments) if (entry.material === material && entry.sellingPrice > 0) counts.set(entry.sellingPrice, (counts.get(entry.sellingPrice) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 70;
}

function Stepper({ value, onChange, min = 0 }) {
  return (
    <div style={s.stepper}>
      <button type="button" style={s.stepBtn} onClick={() => onChange(Math.max(min, Number(value || 0) - 1))} aria-label="Fewer">−</button>
      <input style={s.stepInput} type="number" inputMode="numeric" min={min} value={value} onChange={(event) => onChange(event.target.value === "" ? "" : Math.max(min, Number(event.target.value)))} />
      <button type="button" style={s.stepBtn} onClick={() => onChange(Number(value || 0) + 1)} aria-label="More">+</button>
    </div>
  );
}

function Shell({ title, onClose, busy, children }) {
  return (
    <div style={s.overlay} onClick={() => !busy && onClose()}>
      <div style={s.modal} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={title}>
        <div style={s.head}><h3 style={s.title}>{title}</h3><button type="button" style={s.close} onClick={onClose} disabled={busy} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

const Field = ({ label, hint, children }) => (
  <label style={s.field}><span style={s.label}>{label}</span>{children}{hint ? <small style={s.hint}>{hint}</small> : null}</label>
);

export function AddFilamentModal({ filaments, onSave, onClose, showToast }) {
  const types = useMemo(() => [...new Set([...COMMON_TYPES, ...filaments.map((entry) => entry.material).filter(Boolean)])].sort((a, b) => a.localeCompare(b)), [filaments]);
  const [type, setType] = useState("PLA Matte");
  const [custom, setCustom] = useState("");
  const [color, setColor] = useState("");
  const [spools, setSpools] = useState(1);
  const [status, setStatus] = useState("available");
  const [price, setPrice] = useState(() => usualPrice(filaments, "PLA Matte"));
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);

  const material = type === "__other" ? custom.trim() : type;
  const exists = filaments.some((entry) => entry.material === material && entry.color.trim().toLowerCase() === color.trim().toLowerCase());
  const valid = material && color.trim() && Number(spools) > 0 && !exists;

  const chooseType = (value) => {
    setType(value);
    if (value !== "__other") setPrice(usualPrice(filaments, value));
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onSave({ material, color, spools: Number(spools), sellingPrice: Number(price), purchaseCost: Number(cost) || 0, status });
      showToast(`${material} ${color.trim()} added`);
      onClose();
    } catch {
      showToast("Couldn't add this filament. Try again.");
      setBusy(false);
    }
  };

  return (
    <Shell title="Add filament" onClose={onClose} busy={busy}>
      <Field label="Type">
        <select style={s.input} value={type} onChange={(event) => chooseType(event.target.value)}>
          {types.map((name) => <option key={name} value={name}>{name}</option>)}
          <option value="__other">Other type…</option>
        </select>
      </Field>
      {type === "__other" && <Field label="New type name"><input style={s.input} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="e.g. PLA Wood" /></Field>}
      <Field label="Colour" hint={exists ? "This colour already exists. Use + on its card to add spools." : "For silk write the order, e.g. Red / Yellow / Blue"}>
        <input style={{ ...s.input, ...(exists ? s.inputBad : {}) }} value={color} onChange={(event) => setColor(event.target.value)} placeholder="e.g. Black" autoFocus />
      </Field>
      <Field label="How many spools?"><Stepper value={spools} onChange={setSpools} min={1} /></Field>
      <div style={s.toggle} role="group" aria-label="Stock status">
        <button type="button" style={{ ...s.toggleBtn, ...(status === "available" ? s.toggleOn : {}) }} onClick={() => setStatus("available")}>In stock now</button>
        <button type="button" style={{ ...s.toggleBtn, ...(status === "incoming" ? s.toggleOn : {}) }} onClick={() => setStatus("incoming")}>On order</button>
      </div>
      <div style={s.two}>
        <Field label="Selling price (AED)"><input style={s.input} type="number" inputMode="decimal" min="0" step="0.5" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
        <Field label="Cost per spool (AED)" hint="Optional"><input style={s.input} type="number" inputMode="decimal" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} /></Field>
      </div>
      <div style={s.actions}>
        <button type="button" style={s.cancel} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" style={{ ...s.save, ...(valid ? {} : s.disabled) }} onClick={save} disabled={!valid || busy}>{busy ? "Adding…" : "Add filament"}</button>
      </div>
    </Shell>
  );
}

export function EditFilamentModal({ entry, onSave, onRemove, onClose, showToast }) {
  const incoming = entry.stockStatus === "incoming";
  const [draft, setDraft] = useState({ ...entry, spoolsNow: incoming ? entry.quantitySpools : Math.round((entry.remainingG / Number(entry.spoolWeightG || 1000)) * 10) / 10 });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const weight = Number(draft.spoolWeightG || 1000);

  const save = async () => {
    if (!draft.color.trim() || !draft.material.trim()) return;
    setBusy(true);
    try {
      const spools = Number(draft.spoolsNow) || 0;
      await onSave({ ...draft, quantitySpools: spools, remainingG: incoming ? draft.remainingG : spools * weight, sellingPrice: Number(draft.sellingPrice) || 0, purchaseCost: Number(draft.purchaseCost) || 0 });
      showToast("Saved");
      onClose();
    } catch {
      showToast("Couldn't save. Try again.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${entry.material} ${entry.color}?\n\nIt disappears from your stock and from the shop. Nothing is deleted: you can bring it back from the "Removed" tab.`)) return;
    setBusy(true);
    try {
      await onRemove(entry.id);
      showToast(`${entry.color} removed. Restore it from the Removed tab.`);
      onClose();
    } catch {
      showToast("Couldn't remove it. Try again.");
      setBusy(false);
    }
  };

  return (
    <Shell title={`${entry.material} · ${entry.color}`} onClose={onClose} busy={busy}>
      <Field label="Colour"><input style={s.input} value={draft.color} onChange={(event) => set({ color: event.target.value })} /></Field>
      <Field label={incoming ? "Spools on order" : "Spools in stock"}><Stepper value={draft.spoolsNow} onChange={(value) => set({ spoolsNow: value })} /></Field>
      <div style={s.two}>
        <Field label="Selling price (AED)"><input style={s.input} type="number" inputMode="decimal" min="0" step="0.5" value={draft.sellingPrice} onChange={(event) => set({ sellingPrice: event.target.value })} /></Field>
        <Field label="Cost per spool (AED)"><input style={s.input} type="number" inputMode="decimal" min="0" step="0.01" value={draft.purchaseCost} onChange={(event) => set({ purchaseCost: event.target.value })} /></Field>
      </div>
      <button type="button" style={s.moreBtn} onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Hide" : "Show"} more details</button>
      {more && (
        <div style={s.moreBox}>
          <div style={s.two}>
            <Field label="Type"><input style={s.input} value={draft.material} onChange={(event) => set({ material: event.target.value })} /></Field>
            <Field label="Brand"><input style={s.input} value={draft.brand ?? ""} onChange={(event) => set({ brand: event.target.value })} /></Field>
            <Field label="SKU"><input style={s.input} value={draft.sku ?? ""} onChange={(event) => set({ sku: event.target.value })} /></Field>
            <Field label="Location"><input style={s.input} value={draft.location ?? ""} onChange={(event) => set({ location: event.target.value })} /></Field>
            {incoming && <Field label="Expected date"><input style={s.input} type="date" value={draft.expectedDate ?? ""} onChange={(event) => set({ expectedDate: event.target.value })} /></Field>}
          </div>
          <Field label="Notes"><textarea style={{ ...s.input, minHeight: 64 }} value={draft.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} /></Field>
        </div>
      )}
      <div style={s.actions}>
        <button type="button" style={s.remove} onClick={remove} disabled={busy}>Remove</button>
        <span style={{ flex: 1 }} />
        <button type="button" style={s.cancel} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" style={s.save} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Shell>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 10, background: "rgba(15,23,42,.55)" },
  modal: { width: "100%", maxWidth: 520, maxHeight: "calc(100dvh - 20px)", overflowY: "auto", padding: 20, borderRadius: 16, background: "#fff", display: "grid", gap: 12 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { margin: 0, fontSize: 20, color: "#16324F" },
  close: { width: 38, height: 38, border: "1px solid #DCD5C6", borderRadius: 10, background: "#fff", fontSize: 16, cursor: "pointer" },
  field: { display: "grid", gap: 6 },
  label: { color: "#6B6355", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em" },
  hint: { color: "#8A7F6D", fontSize: 12 },
  input: { width: "100%", minHeight: 46, padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 10, fontSize: 16, background: "#fff", boxSizing: "border-box" },
  inputBad: { borderColor: "#DC2626" },
  two: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "start" },
  stepper: { display: "grid", gridTemplateColumns: "56px 1fr 56px", gap: 8 },
  stepBtn: { minHeight: 52, border: "1px solid #DCD5C6", borderRadius: 10, background: "#F8F5EE", fontSize: 24, fontWeight: 800, color: "#16324F", cursor: "pointer" },
  stepInput: { minHeight: 52, textAlign: "center", border: "1px solid #DCD5C6", borderRadius: 10, fontSize: 22, fontWeight: 900, color: "#16324F", boxSizing: "border-box", width: "100%" },
  toggle: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  toggleBtn: { minHeight: 46, border: "1px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#6B6355", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  toggleOn: { borderColor: "#047857", background: "#ECFDF5", color: "#047857" },
  moreBtn: { justifySelf: "start", padding: "6px 0", border: 0, background: "none", color: "#2E7D8C", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  moreBox: { display: "grid", gap: 10, padding: 12, border: "1px solid #EFEAE0", borderRadius: 12, background: "#FBFAF6" },
  actions: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 },
  cancel: { minHeight: 46, padding: "0 16px", border: "1px solid #DCD5C6", borderRadius: 10, background: "#fff", fontWeight: 800, cursor: "pointer" },
  save: { minHeight: 46, padding: "0 20px", border: 0, borderRadius: 10, background: "#047857", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  disabled: { opacity: 0.45, cursor: "not-allowed" },
  remove: { minHeight: 46, padding: "0 14px", border: "1px solid #F2B8A2", borderRadius: 10, background: "#FFF7F3", color: "#B3451D", fontWeight: 800, cursor: "pointer" },
};
